const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");
const { stdout } = require("process");

const CMDS = ["type", "echo", "exit", "pwd", "cd"];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: (line) => {
    const completions = CMDS.map((cmd) => cmd + " ");
    const hits = completions.filter((c) => c.startsWith(line));
    return [hits.length ? hits : completions, line];
  },
});

rl.setPrompt("$ ");
rl.prompt();

rl.on("line", (input) => {
  input = input.trim();
  execCmd(input).then(() => {
    rl.prompt();
  });
});

function getCmd(answer) {
  const tokens = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < answer.length; i++) {
    const ch = answer[i];

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
      } else {
        current += ch;
      }
      continue;
    }

    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      } else if (ch === "\\" && i + 1 < answer.length) {
        const next = answer[i + 1];
        if (["\\", '"', "$", "`"].includes(next)) {
          current += next;
          i++;
        } else {
          current += "\\";
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'") {
      inSingle = true;
    } else if (ch === '"') {
      inDouble = true;
    } else if (ch === "\\" && i + 1 < answer.length) {
      current += answer[i + 1];
      i++;
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return { cmd: tokens[0] || "", args: tokens.slice(1) };
}

function execCmd(command) {
  return new Promise((resolve) => {
    const { cmd, args } = getCmd(command);
    const { cleanArgs, stdoutFile, stderrFile, append } =
      parseRedirection(args);

    if (cmd === "exit") {
      process.exit(0);
    } else if (cmd === "echo") {
      const echoText = cleanArgs.join(" ");
      writeOutput({ stdoutText: echoText, stdoutFile, stderrFile, append });
      resolve();
    } else if (cmd === "pwd") {
      writeOutput({
        stdoutText: process.cwd(),
        stdoutFile,
        stderrFile,
        append,
      });
      resolve();
    } else if (cmd === "cd") {
      const dir = args[0] || os.homedir();
      changeDirectory(dir);
      resolve();
    } else if (cmd === "type") {
      printType(args[0]);
      resolve();
    } else {
      const execPath = findExecutable(cmd);
      if (!execPath) {
        console.log(`${cmd}: command not found`);
        return resolve();
      }

      const stdio = [
        "inherit",
        stdoutFile ? "pipe" : "inherit",
        stderrFile ? "pipe" : "inherit",
      ];

      const child = spawn(execPath, cleanArgs, { stdio, argv0: cmd });

      // Redirect stdout
      if (stdoutFile) {
        const outStream = fs.createWriteStream(stdoutFile, {
          flags: append ? "a" : "w",
        });
        child.stdout.pipe(outStream);
      }

      // Redirect stderr
      if (stderrFile) {
        const errStream = fs.createWriteStream(stderrFile, {
          flags: append ? "a" : "w",
        });
        child.stderr.pipe(errStream);
      }

      child.on("error", (err) => {
        console.error(`${command}: ${err.message}`);
        resolve();
      });

      child.on("exit", () => {
        resolve();
      });
    }
  });
}

/* cd */
function changeDirectory(dir) {
  try {
    if (dir === "~") {
      dir = os.homedir();
    }
    process.chdir(dir);
  } catch (err) {
    console.error(`cd: ${dir}: No such file or directory`);
  }
}

/* type */
function printType(command) {
  let found = false;
  if (CMDS.includes(command)) {
    console.log(`${command} is a shell builtin`);
    found = true;
  } else {
    const execPath = findExecutable(command);
    if (execPath) {
      console.log(`${command} is ${execPath}`);
      found = true;
    }
  }
  if (!found) {
    console.log(`${command}: not found`);
  }
}

/* find executable */
function findExecutable(command) {
  const paths = process.env.PATH.split(path.delimiter);
  for (const p of paths) {
    const fullPath = path.join(p, command);
    try {
      if (
        fs.existsSync(fullPath) &&
        fs.statSync(fullPath).isFile() &&
        fs.accessSync(fullPath, fs.constants.X_OK) === undefined
      ) {
        return fullPath;
      }
    } catch (err) {
      continue;
    }
  }
  return null;
}

function parseRedirection(args) {
  let stdoutFile = null;
  let stderrFile = null;
  let append = false;
  const cleanArgs = [];

  for (let i = 0; i < args.length; i++) {
    if ([">", "1>"].includes(args[i]) && args[i + 1]) {
      stdoutFile = args[i + 1];
      i++;
    } else if (args[i] === "2>" && args[i + 1]) {
      stderrFile = args[i + 1];
      i++;
    } else if ([">>", "1>>"].includes(args[i]) && args[i + 1]) {
      append = true;
      stdoutFile = args[i + 1];
      i++;
    } else if (args[i] === "2>>" && args[i + 1]) {
      append = true;
      stderrFile = args[i + 1];
      i++;
    } else {
      cleanArgs.push(args[i]);
    }
  }

  return { cleanArgs, stdoutFile, stderrFile, append };
}

function writeOutput({
  stdoutText,
  stdoutFile,
  stderrText,
  stderrFile,
  append,
}) {
  if (stdoutFile) {
    fs.writeFileSync(stdoutFile, stdoutText ? stdoutText + "\n" : "", {
      flag: append ? "a" : "w",
    });
  } else if (stdoutText) {
    process.stdout.write(stdoutText + "\n");
  }

  if (stderrFile) {
    fs.writeFileSync(stderrFile, stderrText ? stderrText + "\n" : "", {
      flag: append ? "a" : "w",
    });
  } else if (stderrText) {
    process.stderr.write(stderrText + "\n");
  }
}