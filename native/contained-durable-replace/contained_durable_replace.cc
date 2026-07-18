#include <node_api.h>

#include <cerrno>
#include <cstring>
#include <exception>
#include <string>
#include <vector>

#if !defined(_WIN32)
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

bool IsSafeName(const std::string& value) {
  return !value.empty() && value.find('/') == std::string::npos && value.find('\\') == std::string::npos && value != "." && value != "..";
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

 private:
  int fd_;
};

bool IsUnsupportedDirectorySync(int error) {
  return error == EINVAL || error == ENOSYS || error == ENOTSUP || error == EOPNOTSUPP || error == EISDIR;
}

bool SyncDirectoryEntry(int parent_fd, bool* directory_sync_unsupported, std::string* error) {
  if (fsync(parent_fd) == 0) return true;
  const int sync_error = errno;
  if (IsUnsupportedDirectorySync(sync_error)) {
    *directory_sync_unsupported = true;
    return true;
  }
  *error = std::string("Unable to sync containing directory after creating contained output directory: ") + std::strerror(sync_error);
  return false;
}

bool OpenDirectoryComponent(
  int parent_fd,
  const char* name,
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

    if (mkdirat(parent_fd, name, 0700) == 0) {
      // A first write changes the parent directory entry too. Apply the same
      // documented downgrade-only directory-fsync policy before proceeding.
      if (!SyncDirectoryEntry(parent_fd, directory_sync_unsupported, error)) return false;
      continue;
    }
    if (errno == EEXIST) continue;
    *error = std::string("Unable to create contained output directory component '") + name + "': " + std::strerror(errno);
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

napi_value OpenContainedDirectory(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3] = {nullptr, nullptr, nullptr};
  if (!ThrowNapiError(env, napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr), "Unable to read openContainedDirectory arguments")) return nullptr;
  if (argc != 3) {
    napi_throw_error(env, nullptr, "openContainedDirectory requires root path and exactly two directory components.");
    return nullptr;
  }

  std::string root;
  std::string first;
  std::string second;
  if (!GetString(env, argv[0], &root) || !GetString(env, argv[1], &first) || !GetString(env, argv[2], &second) || !IsSafeName(first) || !IsSafeName(second)) {
    napi_throw_error(env, nullptr, "Contained output directory arguments are invalid.");
    return nullptr;
  }

#if defined(_WIN32)
  ThrowNativeError(env, "Stable descriptor-relative C-2C publication is not implemented on Windows; refusing to publish rather than falling back to pathname traversal.", "ENOTSUP");
  return nullptr;
#else
  int root_fd = open(root.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
  if (root_fd < 0) {
    const int open_error = errno;
    ThrowNativeError(env, std::string("Unable to open workspace root without following a link: ") + std::strerror(open_error), open_error == ELOOP ? "ELOOP" : "EIO");
    return nullptr;
  }

  int first_fd = -1;
  int output_fd = -1;
  bool directory_sync_unsupported = false;
  std::string error;
  const bool opened = OpenDirectoryComponent(root_fd, first.c_str(), &first_fd, &directory_sync_unsupported, &error) &&
    OpenDirectoryComponent(first_fd, second.c_str(), &output_fd, &directory_sync_unsupported, &error);
  CloseFileDescriptor(&root_fd);
  CloseFileDescriptor(&first_fd);
  if (!opened) {
    CloseFileDescriptor(&output_fd);
    ThrowNativeError(env, error);
    return nullptr;
  }

  DirectoryCapability* capability = nullptr;
  try {
    capability = new DirectoryCapability();
  } catch (const std::exception&) {
    CloseFileDescriptor(&output_fd);
    napi_throw_error(env, nullptr, "Unable to allocate contained output directory capability.");
    return nullptr;
  }
  capability->fd = output_fd;
  capability->directory_sync_unsupported = directory_sync_unsupported;

  napi_value external = nullptr;
  if (!ThrowNapiError(env, napi_create_external(env, capability, CloseCapability, nullptr, &external), "Unable to create contained output directory capability")) {
    CloseCapability(env, capability, nullptr);
    return nullptr;
  }
  return external;
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
  work->directory_fd = dup(capability->fd);
  if (work->directory_fd < 0) {
    const int duplicate_error = errno;
    delete work;
    ThrowNativeError(env, std::string("Unable to retain output directory capability: ") + std::strerror(duplicate_error));
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
    {"openContainedDirectory", nullptr, OpenContainedDirectory, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"replaceAtContainedDirectory", nullptr, ReplaceAtContainedDirectory, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"closeContainedDirectory", nullptr, CloseContainedDirectory, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  if (!ThrowNapiError(env, napi_define_properties(env, exports, 3, properties), "Unable to define contained durable replacement exports")) return nullptr;
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
