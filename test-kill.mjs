import { execFileSync } from "node:child_process";

function test(label, cmd, args) {
  try {
    const out = execFileSync(cmd, args, { stdio: "ignore" });
    console.log(`  ${label}: OK (exit 0)`);
    return true;
  } catch (e) {
    console.log(`  ${label}: FAIL (exit ${e.status})`);
    return false;
  }
}

console.log("=== A) Get-Process non-existent (no -ErrorAction) ===");
test("A", "powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-Process -Name 'NoSuchProcess12345'"]);

console.log("\n=== B) Get-Process non-existent + -EA SilentlyContinue ===");
test("B", "powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-Process -Name 'NoSuchProcess12345' -ErrorAction SilentlyContinue"]);

console.log("\n=== C) Get-Process non-existent + pipe Stop-Process -EA SC ===");
test("C", "powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-Process -Name 'NoSuchProcess12345' -ErrorAction SilentlyContinue | Stop-Process -Force"]);

console.log("\n=== D) try/catch around Get-Process ===");
test("D", "powershell", ["-NoProfile", "-NonInteractive", "-Command", "try { Get-Process -Name 'NoSuchProcess12345' -ErrorAction Stop | Stop-Process -Force } catch {}"]);

console.log("\n=== E) Remove-Item non-existent file with -EA SC ===");
test("E", "powershell", ["-NoProfile", "-NonInteractive", "-Command", "Remove-Item -Path 'C:\\nonexistent\\file.txt' -Force -ErrorAction SilentlyContinue"]);

console.log("\n=== F) Remove-Item non-existent with try/catch ===");
test("F", "powershell", ["-NoProfile", "-NonInteractive", "-Command", "try { Remove-Item -Path 'C:\\nonexistent\\file.txt' -Force -ErrorAction Stop } catch {}"]);

console.log("\n=== G) echo hello ===");
test("G", "powershell", ["-NoProfile", "-NonInteractive", "-Command", "echo hello"]);
