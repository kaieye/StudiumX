/** Shared desktop identity values kept free of Electron side effects for testing. */
export const APP_NAME = 'StudiumX'
export const PACKAGED_APP_USER_MODEL_ID = 'com.local.studiumx'
export const DEVELOPMENT_APP_USER_MODEL_ID = `${PACKAGED_APP_USER_MODEL_ID}.development`

/**
 * Windows caches taskbar grouping and its base icon by AppUserModelID.
 *
 * Development runs are hosted by electron.exe, so sharing the installed app's
 * identity can leave the whole group bound to Electron's executable icon even
 * after BrowserWindow receives the StudiumX icon. A development-only identity
 * gives the dev taskbar group its own icon source without changing release
 * shortcut/update identity.
 */
export function resolveWindowsAppUserModelId(isPackaged: boolean): string {
  return isPackaged ? PACKAGED_APP_USER_MODEL_ID : DEVELOPMENT_APP_USER_MODEL_ID
}
