// Copies the built installer to release/FreshOptimizer-Setup-<version>.exe.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
mkdirSync("release", { recursive: true });
const out = `release/FreshOptimizer-Setup-${version}.exe`;
copyFileSync("setup/target/release/freshoptimizer-setup.exe", out);
console.log(`Installer: ${out}`);
