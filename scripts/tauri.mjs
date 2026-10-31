// `npm run tauri dev` runs against the test profile (own identifier, own data folder) so development
// never touches the real notes. Set ALBARO_REAL=1 to run `dev` against the real data on purpose.
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args[0] === "dev" && !process.env.ALBARO_REAL) {
  args.push("--config", "src-tauri/tauri.test.conf.json");
  console.log("[tauri] test profile: com.albaro.notes.test (ALBARO_REAL=1 for the real data)");
}
const r = spawnSync("tauri", args, { stdio: "inherit", shell: true });
process.exit(r.status ?? 1);
