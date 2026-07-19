#include <node_api.h>

#include <cerrno>
#include <cstring>
#include <exception>
#include <string>
#include <vector>

#if !defined(_WIN32)
#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#endif

namespace {

struct DirectoryCapability {
  int fd = -1;
  bool directory_sync_unsupported = false;
};

struct ReplaceWork {
  napi_async_work work = nullptr;
  napi_deferred deferred = nullptr;
  // This is a per-request duplicate of the external capability. It remains
  // valid if JavaScript closes the external while work is queued.
  int directory_fd = -1;
  std::string filename;
  std::string temporary_name;
  std::vector<uint8_t> content;
  std::string error;
  bool directory_sync_unsupported = false;
};

bool ThrowNapiError(napi_env env, napi_status status, const char* operation) {
  if (status == napi_ok) return true;
  const napi_extended_error_info* info = nullptr;
  const char* detail = "unknown N-API failure";
  if (napi_get_last_error_info(env, &info) == napi_ok && info != nullptr && info->error_message != nullptr) {
    detail = info->error_message;
  }
  std::string message = std::string(operation) + ": " + detail;
  napi_throw_error(env, nullptr, message.c_str());
  return false;
}

napi_value MakeError(napi_env env, const std::string& message, const char* code = nullptr) {
  napi_value text = nullptr;
  if (napi_create_string_utf8(env, message.c_str(), message.size(), &text) != napi_ok) return nullptr;
  napi_value error = nullptr;
  if (napi_create_error(env, nullptr, text, &error) != napi_ok) return nullptr;
  if (code != nullptr) {
    napi_value code_value = nullptr;
    if (napi_create_string_utf8(env, code, NAPI_AUTO_LENGTH, &code_value) != napi_ok) return nullptr;
    if (napi_set_named_property(env, error, "code", code_value) != napi_ok) return nullptr;
  }
  return error;
}

void ThrowNativeError(napi_env env, const std::string& message, const char* code = nullptr) {
  napi_value error = MakeError(env, message, code);
  if (error != nullptr) {
    napi_throw(env, error);
  } else {
    napi_throw_error(env, nullptr, message.c_str());
  }
}

bool GetString(napi_env env, napi_value value, std::string* output) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok) return false;
  try {
    output->resize(length + 1);
  } catch (const std::exception&) {
    return false;
  }
  size_t written = 0;
  if (napi_get_value_string_utf8(env, value, output->data(), length + 1, &written) != napi_ok) return false;
  output->resize(written);
  return true;
}

bool ContainsEmbeddedNul(const std::string& value) {
  return value.find('\0') != std::string::npos;
}

bool IsSafeName(const std::string& value) {
  return !value.empty() && !ContainsEmbeddedNul(value) && value.find('/') == std::string::npos && value.find('\\') == std::string::npos && value != "." && value != "..";
}

bool IsSafeRootPath(const std::string& value) {
  return !value.empty() && !ContainsEmbeddedNul(value);
}

void CloseFileDescriptor(int* fd) {
#if !defined(_WIN32)
  if (*fd >= 0) {
    // Do not retry close after EINTR: the descriptor may already have been
    // released and reused by another thread.
    close(*fd);
    *fd = -1;
  }
#else
  (void)fd;
#endif
}

void CloseCapability(napi_env, void* data, void*) {
  auto* capability = static_cast<DirectoryCapability*>(data);
  if (capability == nullptr) return;
  CloseFileDescriptor(&capability->fd);
  delete capability;
}

void CleanupReplaceWork(ReplaceWork* work) {
  if (work == nullptr) return;
  CloseFileDescriptor(&work->directory_fd);
}


bool GetBoolean(napi_env env, napi_value value, bool* output) {
  return napi_get_value_bool(env, value, output) == napi_ok;
}

bool GetDirectoryCapability(napi_env env, napi_value value, DirectoryCapability** output, const char* operation) {
  DirectoryCapability* capability = nullptr;
  if (!ThrowNapiError(env, napi_get_value_external(env, value, reinterpret_cast<void**>(&capability)), operation)) return false;
  if (capability == nullptr || capability->fd < 0) {
    napi_throw_error(env, nullptr, "Contained directory capability is closed or invalid.");
    return false;
  }
  *output = capability;
  return true;
}

napi_value MakeDirectoryCapability(napi_env env, int fd, bool directory_sync_unsupported) {
  DirectoryCapability* capability = nullptr;
  try {
    capability = new DirectoryCapability();
  } catch (const std::exception&) {
    CloseFileDescriptor(&fd);
    napi_throw_error(env, nullptr, "Unable to allocate contained directory capability.");
    return nullptr;
  }
  capability->fd = fd;
  capability->directory_sync_unsupported = directory_sync_unsupported;

  napi_value external = nullptr;
  if (!ThrowNapiError(env, napi_create_external(env, capability, CloseCapability, nullptr, &external), "Unable to create contained directory capability")) {
    CloseCapability(env, capability, nullptr);
    return nullptr;
  }
  return external;
}

#if !defined(_WIN32)

// Keeps a candidate descriptor closed if a string/vector allocation throws
// while the async worker is constructing its error result.
class ScopedFileDescriptor {
 public:
  explicit ScopedFileDescriptor(int fd) : fd_(fd) {}
  ~ScopedFileDescriptor() { CloseFileDescriptor(&fd_); }

  ScopedFileDescriptor(const ScopedFileDescriptor&) = delete;
  ScopedFileDescriptor& operator=(const ScopedFileDescriptor&) = delete;

  int get() const { return fd_; }
  int release() {
    const int result = fd_;
    fd_ = -1;
    return result;
  }
  void reset(int fd) {
    CloseFileDescriptor(&fd_);
    fd_ = fd;
  }

 private:
  int fd_;
};

bool IsUnsupportedDirectorySync(int error) {
  return error == EINVAL || error == ENOSYS || error == ENOTSUP || error == EOPNOTSUPP || error == EISDIR;
}

bool SyncDirectoryEntry(int parent_fd, bool* directory_sync_unsupported, const char* created_kind, std::string* error) {
  if (fsync(parent_fd) == 0) return true;
  const int sync_error = errno;
  if (IsUnsupportedDirectorySync(sync_error)) {
    *directory_sync_unsupported = true;
    return true;
  }
  *error = std::string("Unable to sync containing directory after creating ") + created_kind + ": " + std::strerror(sync_error);
  return false;
}

bool DuplicateFileDescriptorCloseOnExec(int source_fd, int* result, std::string* error) {
#if defined(F_DUPFD_CLOEXEC)
  const int cloexec_fd = fcntl(source_fd, F_DUPFD_CLOEXEC, 0);
  if (cloexec_fd >= 0) {
    *result = cloexec_fd;
    return true;
  }
  *error = std::string("Unable to duplicate contained directory capability atomically with close-on-exec: ") + std::strerror(errno);
  return false;
#else
  (void)source_fd;
  (void)result;
  *error = "Unable to duplicate contained directory capability atomically with close-on-exec: F_DUPFD_CLOEXEC is unavailable.";
  return false;
#endif
}

bool OpenDirectoryComponent(
  int parent_fd,
  const char* name,
  mode_t create_mode,
  const char* created_kind,
  int* result,
  bool* directory_sync_unsupported,
  std::string* error
) {
  for (;;) {
    const int fd = openat(parent_fd, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (fd >= 0) {
      *result = fd;
      return true;
    }
    const int open_error = errno;
    if (open_error != ENOENT) {
      *error = std::string("Unable to open contained output directory component '") + name + "': " + std::strerror(open_error);
      return false;
    }

    if (mkdirat(parent_fd, name, create_mode) == 0) {
      // A first write changes the parent directory entry too. Apply the same
      // documented downgrade-only directory-fsync policy before proceeding.
      if (!SyncDirectoryEntry(parent_fd, directory_sync_unsupported, created_kind, error)) return false;
      continue;
    }
    if (errno == EEXIST) continue;
    *error = std::string("Unable to create contained output directory component '") + name + "': " + std::strerror(errno);
    return false;
  }
}

// The configured memory-root parent is canonicalized by the trusted main-process
// wrapper before it reaches native code. This intentionally permits OS-managed
// intermediate symlinks (for example macOS /var -> /private/var) only above
// that configuration boundary. The final root itself is still opened relative
// to the retained parent descriptor with O_NOFOLLOW, and every child/file
// operation remains descriptor-relative below that root.
bool OpenConfiguredRootDirectory(
  const std::string& physical_parent,
  const std::string& root_name,
  bool create_if_missing,
  int* result,
  bool* directory_sync_unsupported,
  std::string* error
) {
  ScopedFileDescriptor parent_fd(open(physical_parent.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC));
  if (parent_fd.get() < 0) {
    *error = std::string("Unable to open canonical configured root parent directory: ") + std::strerror(errno);
    return false;
  }

  for (;;) {
    const int root_fd = openat(parent_fd.get(), root_name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (root_fd >= 0) {
      *result = root_fd;
      return true;
    }
    const int open_error = errno;
    if (open_error != ENOENT || !create_if_missing) {
      *error = std::string("Unable to open contained root directory without following a link: ") + std::strerror(open_error);
      return false;
    }
    if (mkdirat(parent_fd.get(), root_name.c_str(), 0700) == 0) {
      // The first creation of a configured memory root is not durable until
      // its already-bound parent directory entry is synced under the same
      // narrow downgrade policy used for contained child directories.
      if (!SyncDirectoryEntry(parent_fd.get(), directory_sync_unsupported, "contained root directory", error)) return false;
      continue;
    }
    if (errno == EEXIST) continue;
    *error = std::string("Unable to create contained root directory: ") + std::strerror(errno);
    return false;
  }
}

bool WriteAll(int fd, const std::vector<uint8_t>& content, std::string* error) {
  size_t offset = 0;
  while (offset < content.size()) {
    const ssize_t wrote = write(fd, content.data() + offset, content.size() - offset);
    if (wrote > 0) {
      offset += static_cast<size_t>(wrote);
      continue;
    }
    if (wrote < 0 && errno == EINTR) continue;
    *error = std::string("Unable to write durable projection candidate: ") + std::strerror(errno);
    return false;
  }
  return true;
}

#endif

napi_value OpenContainedRootDirectory(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3] = {nullptr, nullptr, nullptr};
  if (!ThrowNapiError(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "Unable to read openContainedRootDirectory arguments")) return nullptr;
  if (argc != 3) {
    napi_throw_error(env, nullptr, "openContainedRootDirectory requires a canonical parent path, root name, and create-if-missing flag.");
    return nullptr;
  }

  std::string physical_parent;
  std::string root_name;
  bool create_if_missing = false;
  if (!GetString(env, argv[0], &physical_parent) || !GetString(env, argv[1], &root_name) ||
      !IsSafeRootPath(physical_parent) || physical_parent.front() != '/' || !IsSafeName(root_name) ||
      !GetBoolean(env, argv[2], &create_if_missing)) {
    napi_throw_error(env, nullptr, "Contained root directory arguments are invalid.");
    return nullptr;
  }

#if defined(_WIN32)
  ThrowNativeError(env, "Descriptor-relative contained directory access is not implemented on Windows; refusing pathname traversal.", "ENOTSUP");
  return nullptr;
#else
  int root_fd = -1;
  std::string error;
  bool directory_sync_unsupported = false;
  if (!OpenConfiguredRootDirectory(physical_parent, root_name, create_if_missing, &root_fd, &directory_sync_unsupported, &error)) {
    ThrowNativeError(env, error, errno == ELOOP ? "ELOOP" : "EIO");
    return nullptr;
  }
  return MakeDirectoryCapability(env, root_fd, directory_sync_unsupported);
#endif
}

napi_value OpenContainedDirectoryChild(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3] = {nullptr, nullptr, nullptr};
  if (!ThrowNapiError(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "Unable to read openContainedDirectoryChild arguments")) return nullptr;
  if (argc != 3) {
    napi_throw_error(env, nullptr, "openContainedDirectoryChild requires a parent capability, child name, and create-if-missing flag.");
    return nullptr;
  }

  DirectoryCapability* parent = nullptr;
  std::string name;
  bool create_if_missing = false;
  if (!GetDirectoryCapability(env, argv[0], &parent, "Unable to read contained parent directory capability") ||
      !GetString(env, argv[1], &name) || !IsSafeName(name) || !GetBoolean(env, argv[2], &create_if_missing)) {
    napi_throw_error(env, nullptr, "Contained child directory arguments are invalid.");
    return nullptr;
  }

#if defined(_WIN32)
  ThrowNativeError(env, "Descriptor-relative contained directory access is not implemented on Windows; refusing pathname traversal.", "ENOTSUP");
  return nullptr;
#else
  int child_fd = -1;
  bool directory_sync_unsupported = parent->directory_sync_unsupported;
  std::string error;
  if (create_if_missing) {
    if (!OpenDirectoryComponent(
      parent->fd,
      name.c_str(),
      0700,
      "contained output directory",
      &child_fd,
      &directory_sync_unsupported,
      &error
    )) {
      ThrowNativeError(env, error, errno == ELOOP ? "ELOOP" : "EIO");
      return nullptr;
    }
  } else {
    child_fd = openat(parent->fd, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (child_fd < 0) {
      const int open_error = errno;
      ThrowNativeError(env, std::string("Unable to open contained child directory without following a link: ") + std::strerror(open_error), open_error == ELOOP ? "ELOOP" : (open_error == ENOENT ? "ENOENT" : "EIO"));
      return nullptr;
    }
  }
  return MakeDirectoryCapability(env, child_fd, directory_sync_unsupported);
#endif
}

napi_value OpenContainedWorkspaceDirectoryChild(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3] = {nullptr, nullptr, nullptr};
  if (!ThrowNapiError(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "Unable to read openContainedWorkspaceDirectoryChild arguments")) return nullptr;
  if (argc != 3) {
    napi_throw_error(env, nullptr, "openContainedWorkspaceDirectoryChild requires a parent capability, child name, and create-if-missing flag.");
    return nullptr;
  }

  DirectoryCapability* parent = nullptr;
  std::string name;
  bool create_if_missing = false;
  if (!GetDirectoryCapability(env, argv[0], &parent, "Unable to read contained workspace parent directory capability") ||
      !GetString(env, argv[1], &name) || !IsSafeName(name) || !GetBoolean(env, argv[2], &create_if_missing)) {
    napi_throw_error(env, nullptr, "Contained workspace child directory arguments are invalid.");
    return nullptr;
  }

#if defined(_WIN32)
  ThrowNativeError(env, "Descriptor-relative contained directory access is not implemented on Windows; refusing pathname traversal.", "ENOTSUP");
  return nullptr;
#else
  int child_fd = -1;
  bool directory_sync_unsupported = parent->directory_sync_unsupported;
  std::string error;
  if (create_if_missing) {
    // Workspace-owned parent directories follow ordinary mkdir semantics. The
    // process umask is deliberately left in effect; private C-2C consumers
    // continue to use OpenContainedDirectoryChild's 0700 creation mode.
    if (!OpenDirectoryComponent(
      parent->fd,
      name.c_str(),
      0777,
      "contained workspace directory",
      &child_fd,
      &directory_sync_unsupported,
      &error
    )) {
      ThrowNativeError(env, error, errno == ELOOP ? "ELOOP" : "EIO");
      return nullptr;
    }
  } else {
    child_fd = openat(parent->fd, name.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (child_fd < 0) {
      const int open_error = errno;
      ThrowNativeError(env, std::string("Unable to open contained workspace child directory without following a link: ") + std::strerror(open_error), open_error == ELOOP ? "ELOOP" : (open_error == ENOENT ? "ENOENT" : "EIO"));
      return nullptr;
    }
  }
  return MakeDirectoryCapability(env, child_fd, directory_sync_unsupported);
#endif
}

napi_value InspectContainedDirectoryLeaf(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2] = {nullptr, nullptr};
  if (!ThrowNapiError(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "Unable to read inspectContainedDirectoryLeaf arguments")) return nullptr;
  if (argc != 2) {
    napi_throw_error(env, nullptr, "inspectContainedDirectoryLeaf requires a directory capability and leaf name.");
    return nullptr;
  }

  DirectoryCapability* capability = nullptr;
  std::string name;
  if (!GetDirectoryCapability(env, argv[0], &capability, "Unable to read contained directory capability") ||
      !GetString(env, argv[1], &name) || !IsSafeName(name)) {
    napi_throw_error(env, nullptr, "Contained leaf inspection arguments are invalid.");
    return nullptr;
  }

#if defined(_WIN32)
  ThrowNativeError(env, "Descriptor-relative contained directory access is not implemented on Windows; refusing pathname traversal.", "ENOTSUP");
  return nullptr;
#else
  struct stat leaf_stats {};
  const int inspect_result = fstatat(capability->fd, name.c_str(), &leaf_stats, AT_SYMLINK_NOFOLLOW);
  const int inspect_error = errno;

  const char* type = "other";
  bool absent = false;
  if (inspect_result != 0) {
    if (inspect_error != ENOENT) {
      ThrowNativeError(env, std::string("Unable to inspect contained final leaf without following a link: ") + std::strerror(inspect_error), inspect_error == ELOOP ? "ELOOP" : "EIO");
      return nullptr;
    }
    type = "absent";
    absent = true;
  } else if (S_ISREG(leaf_stats.st_mode)) {
    type = "regular";
  } else if (S_ISDIR(leaf_stats.st_mode)) {
    type = "directory";
  } else if (S_ISLNK(leaf_stats.st_mode)) {
    type = "symlink";
  }

  napi_value result = nullptr;
  napi_value type_value = nullptr;
  if (!ThrowNapiError(env, napi_create_object(env, &result), "Unable to allocate contained leaf inspection result") ||
      !ThrowNapiError(env, napi_create_string_utf8(env, type, NAPI_AUTO_LENGTH, &type_value), "Unable to create contained leaf type") ||
      !ThrowNapiError(env, napi_set_named_property(env, result, "type", type_value), "Unable to set contained leaf type")) return nullptr;
  if (!absent) {
    napi_value mode = nullptr;
    napi_value link_count = nullptr;
    if (!ThrowNapiError(env, napi_create_uint32(env, static_cast<uint32_t>(leaf_stats.st_mode), &mode), "Unable to create contained leaf mode") ||
        !ThrowNapiError(env, napi_create_double(env, static_cast<double>(leaf_stats.st_nlink), &link_count), "Unable to create contained leaf link count") ||
        !ThrowNapiError(env, napi_set_named_property(env, result, "mode", mode), "Unable to set contained leaf mode") ||
        !ThrowNapiError(env, napi_set_named_property(env, result, "linkCount", link_count), "Unable to set contained leaf link count")) return nullptr;
  }
  return result;
#endif
}

napi_value SyncContainedDirectory(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {nullptr};
  if (!ThrowNapiError(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "Unable to read syncContainedDirectory arguments")) return nullptr;
  if (argc != 1) {
    napi_throw_error(env, nullptr, "syncContainedDirectory requires a directory capability.");
    return nullptr;
  }

  DirectoryCapability* capability = nullptr;
  if (!GetDirectoryCapability(env, argv[0], &capability, "Unable to read contained directory capability")) return nullptr;

#if defined(_WIN32)
  ThrowNativeError(env, "Descriptor-relative contained directory access is not implemented on Windows; refusing pathname traversal.", "ENOTSUP");
  return nullptr;
#else
  if (fsync(capability->fd) != 0) {
    const int sync_error = errno;
    ThrowNativeError(env, std::string("Unable to sync contained directory: ") + std::strerror(sync_error), IsUnsupportedDirectorySync(sync_error) ? "ENOTSUP" : "EIO");
    return nullptr;
  }
  napi_value undefined = nullptr;
  if (!ThrowNapiError(env, napi_get_undefined(env, &undefined), "Unable to return from syncContainedDirectory")) return nullptr;
  return undefined;
#endif
}

napi_value ListContainedDirectory(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {nullptr};
  if (!ThrowNapiError(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "Unable to read listContainedDirectory arguments")) return nullptr;
  if (argc != 1) {
    napi_throw_error(env, nullptr, "listContainedDirectory requires a directory capability.");
    return nullptr;
  }
  DirectoryCapability* capability = nullptr;
  if (!GetDirectoryCapability(env, argv[0], &capability, "Unable to read contained directory capability")) return nullptr;

#if defined(_WIN32)
  ThrowNativeError(env, "Descriptor-relative contained directory access is not implemented on Windows; refusing pathname traversal.", "ENOTSUP");
  return nullptr;
#else
  int listing_fd = -1;
  std::string duplicate_error;
  if (!DuplicateFileDescriptorCloseOnExec(capability->fd, &listing_fd, &duplicate_error)) {
    ThrowNativeError(env, duplicate_error);
    return nullptr;
  }
  DIR* directory = fdopendir(listing_fd);
  if (directory == nullptr) {
    const int open_error = errno;
    CloseFileDescriptor(&listing_fd);
    ThrowNativeError(env, std::string("Unable to list contained directory: ") + std::strerror(open_error));
    return nullptr;
  }

  struct Entry { std::string name; const char* type; };
  std::vector<Entry> entries;
  errno = 0;
  while (dirent* entry = readdir(directory)) {
    const std::string name(entry->d_name);
    if (name == "." || name == "..") continue;
    struct stat entry_stats {};
    const char* type = "other";
    if (fstatat(capability->fd, name.c_str(), &entry_stats, AT_SYMLINK_NOFOLLOW) == 0) {
      if (S_ISLNK(entry_stats.st_mode)) type = "symlink";
      else if (S_ISREG(entry_stats.st_mode)) type = "file";
      else if (S_ISDIR(entry_stats.st_mode)) type = "directory";
    }
    try {
      entries.push_back({name, type});
    } catch (const std::exception&) {
      closedir(directory);
      napi_throw_error(env, nullptr, "Unable to allocate contained directory listing.");
      return nullptr;
    }
  }
  const int read_error = errno;
  closedir(directory);
  if (read_error != 0) {
    ThrowNativeError(env, std::string("Unable to finish listing contained directory: ") + std::strerror(read_error));
    return nullptr;
  }

  napi_value result = nullptr;
  if (!ThrowNapiError(env, napi_create_array_with_length(env, entries.size(), &result), "Unable to allocate contained directory listing result")) return nullptr;
  for (size_t index = 0; index < entries.size(); index += 1) {
    napi_value item = nullptr;
    napi_value name = nullptr;
    napi_value type = nullptr;
    if (!ThrowNapiError(env, napi_create_object(env, &item), "Unable to allocate contained directory listing entry") ||
        !ThrowNapiError(env, napi_create_string_utf8(env, entries[index].name.c_str(), entries[index].name.size(), &name), "Unable to create contained directory entry name") ||
        !ThrowNapiError(env, napi_create_string_utf8(env, entries[index].type, NAPI_AUTO_LENGTH, &type), "Unable to create contained directory entry type") ||
        !ThrowNapiError(env, napi_set_named_property(env, item, "name", name), "Unable to set contained directory entry name") ||
        !ThrowNapiError(env, napi_set_named_property(env, item, "type", type), "Unable to set contained directory entry type") ||
        !ThrowNapiError(env, napi_set_element(env, result, index, item), "Unable to append contained directory entry")) return nullptr;
  }
  return result;
#endif
}

napi_value ReadRegularFileAtContainedDirectory(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2] = {nullptr, nullptr};
  if (!ThrowNapiError(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "Unable to read readRegularFileAtContainedDirectory arguments")) return nullptr;
  if (argc != 2) {
    napi_throw_error(env, nullptr, "readRegularFileAtContainedDirectory requires a directory capability and filename.");
    return nullptr;
  }
  DirectoryCapability* capability = nullptr;
  std::string name;
  if (!GetDirectoryCapability(env, argv[0], &capability, "Unable to read contained directory capability") || !GetString(env, argv[1], &name) || !IsSafeName(name)) {
    napi_throw_error(env, nullptr, "Contained regular file arguments are invalid.");
    return nullptr;
  }

#if defined(_WIN32)
  ThrowNativeError(env, "Descriptor-relative contained directory access is not implemented on Windows; refusing pathname traversal.", "ENOTSUP");
  return nullptr;
#else
  ScopedFileDescriptor file_fd(openat(capability->fd, name.c_str(), O_RDONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC));
  if (file_fd.get() < 0) {
    const int open_error = errno;
    ThrowNativeError(env, std::string("Unable to open contained regular file without following a link: ") + std::strerror(open_error), open_error == ELOOP ? "ELOOP" : (open_error == ENOENT ? "ENOENT" : "EIO"));
    return nullptr;
  }
  struct stat file_stats {};
  if (fstat(file_fd.get(), &file_stats) != 0 || !S_ISREG(file_stats.st_mode)) {
    ThrowNativeError(env, "Contained file is not a regular file.", "EINVAL");
    return nullptr;
  }
  std::vector<uint8_t> content;
  try {
    if (file_stats.st_size > 0) content.reserve(static_cast<size_t>(file_stats.st_size));
    uint8_t chunk[65536];
    for (;;) {
      const ssize_t count = read(file_fd.get(), chunk, sizeof(chunk));
      if (count > 0) {
        content.insert(content.end(), chunk, chunk + count);
        continue;
      }
      if (count == 0) break;
      if (errno == EINTR) continue;
      ThrowNativeError(env, std::string("Unable to read contained regular file: ") + std::strerror(errno));
      return nullptr;
    }
  } catch (const std::exception&) {
    napi_throw_error(env, nullptr, "Unable to allocate contained regular file content.");
    return nullptr;
  }
  napi_value result = nullptr;
  if (!ThrowNapiError(env, napi_create_buffer_copy(env, content.size(), content.empty() ? nullptr : content.data(), nullptr, &result), "Unable to return contained regular file content")) return nullptr;
  return result;
#endif
}

void ExecuteReplace(napi_env, void* raw) {
  auto* work = static_cast<ReplaceWork*>(raw);
  if (work == nullptr) return;

#if defined(_WIN32)
  work->error = "Stable descriptor-relative C-2C publication is unavailable on Windows.";
#else
  bool published = false;
  try {
    const int directory_fd = work->directory_fd;
    if (directory_fd < 0) {
      work->error = "Contained output directory capability was closed before durable replacement began.";
    } else {
      ScopedFileDescriptor temporary_fd(openat(
        directory_fd,
        work->temporary_name.c_str(),
        O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
        0600
      ));
      if (temporary_fd.get() < 0) {
        work->error = std::string("Unable to create durable projection candidate: ") + std::strerror(errno);
      } else {
        if (fchmod(temporary_fd.get(), 0600) != 0) {
          work->error = std::string("Unable to set durable projection candidate mode: ") + std::strerror(errno);
        } else if (!WriteAll(temporary_fd.get(), work->content, &work->error)) {
        } else if (fsync(temporary_fd.get()) != 0) {
          work->error = std::string("Unable to sync durable projection candidate: ") + std::strerror(errno);
        }

        // close(2) is intentionally not retried after EINTR. Release the RAII
        // wrapper first because the descriptor may already be closed/reused.
        const int temporary_fd_to_close = temporary_fd.release();
        if (close(temporary_fd_to_close) != 0 && work->error.empty()) {
          work->error = std::string("Unable to close durable projection candidate: ") + std::strerror(errno);
        }

        if (work->error.empty()) {
          if (renameat(directory_fd, work->temporary_name.c_str(), directory_fd, work->filename.c_str()) != 0) {
            work->error = std::string("Unable to publish durable projection candidate: ") + std::strerror(errno);
          } else {
            published = true;
            if (fsync(directory_fd) != 0) {
              const int sync_error = errno;
              if (IsUnsupportedDirectorySync(sync_error)) {
                work->directory_sync_unsupported = true;
              } else {
                work->error = std::string("Unable to sync durable projection directory: ") + std::strerror(sync_error);
              }
            }
          }
        }
      }
    }
  } catch (const std::exception&) {
    // N-API completion still owns resolving/rejecting and deleting this work.
    // The local RAII object closes any candidate descriptor before this point.
    if (work->error.empty()) {
      try {
        work->error = "Unexpected native failure during contained durable replacement.";
      } catch (...) {
      }
    }
  } catch (...) {
    if (work->error.empty()) {
      try {
        work->error = "Unexpected native failure during contained durable replacement.";
      } catch (...) {
      }
    }
  }

  // After rename, never remove the final output merely because its directory
  // fsync reported an error. Only an unpublished temporary is disposable.
  if (!published && work->directory_fd >= 0) unlinkat(work->directory_fd, work->temporary_name.c_str(), 0);
  CleanupReplaceWork(work);
#endif
}

void CompleteReplace(napi_env env, napi_status status, void* raw) {
  auto* work = static_cast<ReplaceWork*>(raw);
  if (work == nullptr) return;

  if (status != napi_ok && work->error.empty()) {
    work->error = "Contained durable replacement async work did not complete successfully.";
  }

  if (!work->error.empty()) {
    napi_value rejection = MakeError(env, work->error);
    if (rejection == nullptr) napi_get_undefined(env, &rejection);
    napi_reject_deferred(env, work->deferred, rejection);
  } else {
    napi_value result = nullptr;
    napi_value unsupported = nullptr;
    if (napi_create_object(env, &result) == napi_ok &&
        napi_get_boolean(env, work->directory_sync_unsupported, &unsupported) == napi_ok &&
        napi_set_named_property(env, result, "directorySyncUnsupported", unsupported) == napi_ok) {
      napi_resolve_deferred(env, work->deferred, result);
    } else {
      napi_value rejection = MakeError(env, "Unable to report contained durable replacement completion.");
      if (rejection == nullptr) napi_get_undefined(env, &rejection);
      napi_reject_deferred(env, work->deferred, rejection);
    }
  }

  CleanupReplaceWork(work);
  if (work->work != nullptr) napi_delete_async_work(env, work->work);
  delete work;
}

napi_value ReplaceAtContainedDirectory(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4] = {nullptr, nullptr, nullptr, nullptr};
  if (!ThrowNapiError(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "Unable to read replaceAtContainedDirectory arguments")) return nullptr;
  if (argc != 4) {
    napi_throw_error(env, nullptr, "replaceAtContainedDirectory requires a directory capability, final name, temporary name, and content.");
    return nullptr;
  }

  DirectoryCapability* capability = nullptr;
  if (!ThrowNapiError(env, napi_get_value_external(env, argv[0], reinterpret_cast<void**>(&capability)), "Unable to read contained output directory capability")) return nullptr;
  if (capability == nullptr || capability->fd < 0) {
    napi_throw_error(env, nullptr, "Contained output directory capability is closed or invalid.");
    return nullptr;
  }

  ReplaceWork* work = nullptr;
  try {
    work = new ReplaceWork();
    if (!GetString(env, argv[1], &work->filename) || !GetString(env, argv[2], &work->temporary_name) || !IsSafeName(work->filename) || !IsSafeName(work->temporary_name)) {
      delete work;
      napi_throw_error(env, nullptr, "Contained durable replacement names are invalid.");
      return nullptr;
    }

    bool is_buffer = false;
    if (!ThrowNapiError(env, napi_is_buffer(env, argv[3], &is_buffer), "Unable to inspect contained durable replacement content")) {
      delete work;
      return nullptr;
    }
    if (!is_buffer) {
      delete work;
      napi_throw_error(env, nullptr, "Contained durable replacement content must be a Buffer.");
      return nullptr;
    }

    void* bytes = nullptr;
    size_t length = 0;
    if (!ThrowNapiError(env, napi_get_buffer_info(env, argv[3], &bytes, &length), "Unable to read contained durable replacement content")) {
      delete work;
      return nullptr;
    }
    work->content.assign(static_cast<uint8_t*>(bytes), static_cast<uint8_t*>(bytes) + length);
  } catch (const std::exception&) {
    CleanupReplaceWork(work);
    delete work;
    napi_throw_error(env, nullptr, "Unable to allocate contained durable replacement work.");
    return nullptr;
  }

#if !defined(_WIN32)
  std::string duplicate_error;
  if (!DuplicateFileDescriptorCloseOnExec(capability->fd, &work->directory_fd, &duplicate_error)) {
    delete work;
    ThrowNativeError(env, duplicate_error);
    return nullptr;
  }
#endif
  work->directory_sync_unsupported = capability->directory_sync_unsupported;

  napi_value promise = nullptr;
  if (!ThrowNapiError(env, napi_create_promise(env, &work->deferred, &promise), "Unable to create contained durable replacement promise")) {
    CleanupReplaceWork(work);
    delete work;
    return nullptr;
  }

  napi_value resource_name = nullptr;
  if (!ThrowNapiError(env, napi_create_string_utf8(env, "containedDurableReplace", NAPI_AUTO_LENGTH, &resource_name), "Unable to name contained durable replacement async work")) {
    CleanupReplaceWork(work);
    delete work;
    return nullptr;
  }

  if (!ThrowNapiError(env, napi_create_async_work(env, nullptr, resource_name, ExecuteReplace, CompleteReplace, work, &work->work), "Unable to create contained durable replacement async work")) {
    CleanupReplaceWork(work);
    delete work;
    return nullptr;
  }

  if (!ThrowNapiError(env, napi_queue_async_work(env, work->work), "Unable to queue contained durable replacement async work")) {
    napi_delete_async_work(env, work->work);
    work->work = nullptr;
    CleanupReplaceWork(work);
    delete work;
    return nullptr;
  }
  return promise;
}

napi_value CloseContainedDirectoryChecked(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {nullptr};
  if (!ThrowNapiError(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "Unable to read closeContainedDirectoryChecked arguments")) return nullptr;
  if (argc != 1) {
    napi_throw_error(env, nullptr, "Contained output directory capability is invalid.");
    return nullptr;
  }
  DirectoryCapability* capability = nullptr;
  if (!ThrowNapiError(env, napi_get_value_external(env, argv[0], reinterpret_cast<void**>(&capability)), "Unable to read contained output directory capability")) return nullptr;
  if (capability == nullptr || capability->fd < 0) {
    napi_throw_error(env, nullptr, "Contained output directory capability is closed or invalid.");
    return nullptr;
  }

#if defined(_WIN32)
  ThrowNativeError(env, "Descriptor-relative contained directory access is not implemented on Windows; refusing pathname traversal.", "ENOTSUP");
  return nullptr;
#else
  // Do not retry close after EINTR: POSIX permits the descriptor to have been
  // released already. Mark it closed before surfacing the failure.
  const int fd = capability->fd;
  capability->fd = -1;
  if (close(fd) != 0) {
    ThrowNativeError(env, std::string("Unable to close contained directory: ") + std::strerror(errno), "EIO");
    return nullptr;
  }
  napi_value undefined = nullptr;
  if (!ThrowNapiError(env, napi_get_undefined(env, &undefined), "Unable to return from closeContainedDirectoryChecked")) return nullptr;
  return undefined;
#endif
}

napi_value CloseContainedDirectory(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1] = {nullptr};
  if (!ThrowNapiError(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "Unable to read closeContainedDirectory arguments")) return nullptr;

  if (argc != 1) {
    napi_throw_error(env, nullptr, "Contained output directory capability is invalid.");
    return nullptr;
  }
  DirectoryCapability* capability = nullptr;
  if (!ThrowNapiError(env, napi_get_value_external(env, argv[0], reinterpret_cast<void**>(&capability)), "Unable to read contained output directory capability")) return nullptr;
  if (capability == nullptr) {
    napi_throw_error(env, nullptr, "Contained output directory capability is invalid.");
    return nullptr;
  }
  CloseFileDescriptor(&capability->fd);

  napi_value undefined = nullptr;
  if (!ThrowNapiError(env, napi_get_undefined(env, &undefined), "Unable to return from closeContainedDirectory")) return nullptr;
  return undefined;
}

napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"openContainedRootDirectory", nullptr, OpenContainedRootDirectory, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"openContainedDirectoryChild", nullptr, OpenContainedDirectoryChild, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"openContainedWorkspaceDirectoryChild", nullptr, OpenContainedWorkspaceDirectoryChild, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"inspectContainedDirectoryLeaf", nullptr, InspectContainedDirectoryLeaf, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"syncContainedDirectory", nullptr, SyncContainedDirectory, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"listContainedDirectory", nullptr, ListContainedDirectory, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"readRegularFileAtContainedDirectory", nullptr, ReadRegularFileAtContainedDirectory, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"replaceAtContainedDirectory", nullptr, ReplaceAtContainedDirectory, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"closeContainedDirectoryChecked", nullptr, CloseContainedDirectoryChecked, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"closeContainedDirectory", nullptr, CloseContainedDirectory, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  if (!ThrowNapiError(env, napi_define_properties(env, exports, 10, properties), "Unable to define contained durable replacement exports")) return nullptr;
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
