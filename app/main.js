const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const os = require("os");
const { stdout } = require("process");

const CMDS = ["type", "echo", "exit", "pwd", "cd", "history"];

let lastCompletionInput = "";
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: (line) => {
    const executablePaths = process.env.PATH.split(path.delimiter)
      .map((p) => {
        try {
          return fs.readdirSync(p);
        } catch (err) {
          return [];
        }
      })
      .flat();
    const allPaths = [...executablePaths, ...CMDS];
    const completions = [...new Set(allPaths)];

    const hits = completions.filter((c) => c.startsWith(line));

    if (hits.length === 1) {
      return [[hits[0] + " "], line];
    } else if (hits.length > 1 && line !== lastCompletionInput) {
      process.stdout.write("\x07");
      // Find longest common prefix
      let prefix = hits[0];
      for (let i = 1; i < hits.length; i++) {
        let j = 0;
        while (
          j < prefix.length &&
          j < hits[i].length &&
          prefix[j] === hits[i][j]
        ) {
          j++;
        }
        prefix = prefix.slice(0, j);
      }
      lastCompletionInput = line;
      if (prefix.length > line.length) {
        return [[prefix], line];
      }
    } else if (hits.length > 1 && line === lastCompletionInput) {
      process.stdout.write("\n" + hits.sort().join("  ") + "\n");
      rl.prompt();
      lastCompletionInput = "";
    } else if (line.length > 0) {
      process.stdout.write("\x07");
      lastCompletionInput = line;
    }
    return [[], line];
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
  let cmd;
  let endIndex = 1;

  if (answer[0] === '"' || answer[0] === "'") {
    const quoteChar = answer[0];
    while (endIndex < answer.length && answer[endIndex] !== quoteChar) {
      endIndex++;
    }
    cmd = answer.slice(1, endIndex);
  } else {
    while (endIndex < answer.length && !/\s/.test(answer[endIndex])) {
      endIndex++;
    }
    cmd = answer.slice(0, endIndex);
  }

  let quoteChar = null;
  let currentArg = "";
  const args = [];

  for (let i = endIndex + 1; i < answer.length; i++) {
    const char = answer[i];

    if (quoteChar) {
      if (char === quoteChar) {
        quoteChar = null;
      } else if (char === "\\" && quoteChar === '"') {
        i++;
        if (i < answer.length) {
          const nextChar = answer[i];
          const allowedEscapes = ['"', "\\"];
          if (allowedEscapes.includes(nextChar)) {
            currentArg += nextChar;
          } else {
            currentArg += "\\" + nextChar;
          }
        }
      } else {
        currentArg += char;
      }
    } else {
      if (char === "\\") {
        i++;
        if (i < answer.length) {
          currentArg += answer[i];
        }
      } else if (char === '"' || char === "'") {
        quoteChar = char;
      } else if (/\s/.test(char)) {
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }
      } else {
        currentArg += char;
      }
    }
  }

  if (currentArg.length > 0) {
    args.push(currentArg);
  }

  return { cmd, args };
}

function execCmd(command) {
  return new Promise((resolve) => {
    const pipelineStages = splitPipelineStages(command);
    if (pipelineStages.length > 1) {
      runPipelineStages(pipelineStages, resolve);
      return;
    }

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
        console.log(`${command}: command not found`);
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

function splitPipelineStages(input) {
  const stages = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\" && !inSingle) {
      escaped = true;
      current += ch;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (ch === "|" && !inSingle && !inDouble) {
      stages.push(current.trim());
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.trim().length > 0) {
    stages.push(current.trim());
  }

  return stages;
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

function runPipelineStages(stageCommands, resolve) {
  if (stageCommands.length < 2) {
    resolve();
    return;
  }

  let prevStdout = null;
  let lastChild = null;

  for (let i = 0; i < stageCommands.length; i++) {
    const stage = stageCommands[i];
    const { cmd, args } = getCmd(stage);
    const { cleanArgs } = parseRedirection(args);

    const execPath = findExecutable(cmd);
    if (!execPath) {
      console.log(`${cmd}: command not found`);
      resolve();
      return;
    }

    const isLast = i === stageCommands.length - 1;
    const stdio = [prevStdout ? "pipe" : "inherit", isLast ? "inherit" : "pipe", "inherit"];
    const child = spawn(execPath, cleanArgs, { stdio, argv0: cmd });

    child.on("error", (err) => {
      if (err && err.code !== "EPIPE") {
        console.error(`${cmd}: ${err.message}`);
      }
      resolve();
    });

    if (prevStdout) {
      prevStdout.on("error", (err) => {
        if (!err || err.code !== "EPIPE") {
          // Ignore expected broken pipe behavior from short-lived downstream commands.
        }
      });
      if (child.stdin) {
        child.stdin.on("error", (err) => {
          if (!err || err.code !== "EPIPE") {
            // Ignore expected broken pipe behavior from short-lived downstream commands.
          }
        });
      }
      prevStdout.pipe(child.stdin);
    }

    prevStdout = child.stdout;
    lastChild = child;
  }

  if (!lastChild) {
    resolve();
    return;
  }

  lastChild.on("exit", () => {
    resolve();
  });
}
