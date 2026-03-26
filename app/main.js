const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const BUILTIN = ["exit", "echo", "type", "pwd", "cd", "history"];

const history = [];
let tabCount = 0;

// ---------- COMPLETER ----------
function getCommands() {
  const paths = (process.env.PATH || "").split(path.delimiter);
  const cmds = {};

  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
      for (const f of fs.readdirSync(p)) {
        cmds[f] = true;
      }
    } catch {}
  }
  return cmds;
}

function completer(line) {
  const cmds = [...BUILTIN, ...Object.keys(getCommands())];
  const hits = cmds.filter(c => c.startsWith(line)).sort();

  if (hits.length === 0) {
    process.stdout.write("\x07");
    tabCount = 0;
    return [[], line];
  }

  if (hits.length === 1) {
    tabCount = 0;
    return [[hits[0] + " "], line];
  }

  if (tabCount === 0) {
    process.stdout.write("\x07");
    tabCount++;
    return [[], line];
  }

  console.log("\n" + hits.join("  "));
  rl.prompt();

  tabCount = 0;
  return [[], line];
}

// ---------- READLINE ----------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
  completer,
});

rl.prompt();

rl.on("line", async (input) => {
  tabCount = 0;

  const line = input.trim();
  history.push(line);

  if (!line) {
    rl.prompt();
    return;
  }

  let tokens = line.split(" ");

  // ---------- REDIRECTION PARSE ----------
  let stdoutFile = null;
  let stderrFile = null;
  let appendOut = false;
  let appendErr = false;

  const cleaned = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t === ">" || t === "1>") {
      stdoutFile = tokens[i + 1];
      appendOut = false;
      i++;
    } else if (t === ">>" || t === "1>>") {
      stdoutFile = tokens[i + 1];
      appendOut = true;
      i++;
    } else if (t === "2>") {
      stderrFile = tokens[i + 1];
      appendErr = false;
      i++;
    } else if (t === "2>>") {
      stderrFile = tokens[i + 1];
      appendErr = true;
      i++;
    } else {
      cleaned.push(t);
    }
  }

  const cmd = cleaned[0];

  // ---------- BUILTINS ----------
  if (cmd === "exit") process.exit();

  if (cmd === "pwd") {
    console.log(process.cwd());
  }

  else if (cmd === "cd") {
    try {
      process.chdir(cleaned[1] || process.env.HOME);
    } catch {
      console.error(`cd: ${cleaned[1]}: No such file or directory`);
    }
  }

  else if (cmd === "echo") {
    console.log(cleaned.slice(1).join(" "));
  }

  else if (cmd === "type") {
    if (BUILTIN.includes(cleaned[1])) {
      console.log(`${cleaned[1]} is a shell builtin`);
    } else {
      const cmds = getCommands();
      if (cmds[cleaned[1]]) {
        console.log(cleaned[1]);
      } else {
        console.error(`${cleaned[1]}: not found`);
      }
    }
  }

  else if (cmd === "history") {
    let n = history.length;

    if (cleaned[1]) {
      const val = parseInt(cleaned[1], 10);
      if (!isNaN(val)) n = val;
    }

    const start = Math.max(0, history.length - n);

    for (let i = start; i < history.length; i++) {
      console.log(`${(i + 1).toString().padStart(5)}  ${history[i]}`);
    }
  }

  // ---------- EXTERNAL ----------
  else {
    try {
      const child = spawn(cmd, cleaned.slice(1), {
        stdio: ["inherit", "pipe", "pipe"]
      });

      // stdout handling
      if (stdoutFile) {
        const fd = fs.openSync(
          path.resolve(stdoutFile),
          appendOut ? "a" : "w"
        );
        child.stdout.on("data", d => fs.writeSync(fd, d));
      } else {
        child.stdout.pipe(process.stdout);
      }

      // stderr handling (THIS FIXES YOUR BUG)
      if (stderrFile) {
        const fd = fs.openSync(
          path.resolve(stderrFile),
          appendErr ? "a" : "w"
        );
        child.stderr.on("data", d => fs.writeSync(fd, d));
      } else {
        child.stderr.pipe(process.stderr);
      }

      await new Promise(res => child.on("close", res));

    } catch {
      console.error(`${cmd}: command not found`);
    }
  }

  rl.prompt();
});