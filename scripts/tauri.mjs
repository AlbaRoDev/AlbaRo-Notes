// `npm run tauri dev` runs against the test profile (own identifier, own data folder) so development
// never touches the real notes. Set ALBARO_REAL=1 to run `dev` against the real data on purpose.
//
// Mobile test bench (see the three loops in the project notes):
//   ALBARO_MOBILE=1 npm run tauri dev   desktop window the size of a phone, `data-mobile` forced on
//   npm run tauri android dev           emulator or USB phone; the debug app has its own package id
//                                       (`.debug` suffix in build.gradle.kts), so its data is separate too
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const env = { ...process.env };
const isAndroid = args[0] === "android";
const isAndroidDev = isAndroid && args[1] === "dev";

if (args[0] === "dev" && !env.ALBARO_REAL) {
  // The Android identifier cannot be swapped like this: the Rust side is bound to it by name.
  args.push("--config", "src-tauri/tauri.test.conf.json");
  console.log("[tauri] test profile: com.albaro.notes.test (ALBARO_REAL=1 for the real data)");
}

if (args[0] === "dev" && env.ALBARO_MOBILE) {
  args.push("--config", "src-tauri/tauri.mobile-sim.conf.json");
  env.VITE_ALBARO_MOBILE = "1";
  console.log("[tauri] phone-sized window, data-mobile forced");
}

if (isAndroid) {
  // New terminals pick these up from the user environment; this keeps a terminal opened before that working.
  const sdk = env.ANDROID_HOME || join(env.LOCALAPPDATA ?? "", "Android", "Sdk");
  env.ANDROID_HOME = sdk;
  const ndks = existsSync(join(sdk, "ndk")) ? readdirSync(join(sdk, "ndk")).sort() : [];
  if (!env.NDK_HOME && ndks.length) env.NDK_HOME = join(sdk, "ndk", ndks[ndks.length - 1]);
}

if (isAndroidDev) {
  // Its own Vite port, so it runs beside a desktop `tauri dev` (which holds 1420).
  env.ALBARO_VITE_PORT = "1425";
  args.push("--config", "src-tauri/tauri.android-dev.conf.json");
}

const r = spawnSync("tauri", args, { stdio: "inherit", shell: true, env });
process.exit(r.status ?? 1);
