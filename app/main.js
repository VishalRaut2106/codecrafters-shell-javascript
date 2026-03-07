const readline = require("node:readline/promises");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("child_process");
const os = require("os");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: (line) => {
    const pathDirs = (process.env.PATH || "").split(path.delimiter);
    const completions = ["echo", "exit", "pwd", "cd", "type"];
    pathDirs.forEach((dir) => {
      try {
        const files = fs.readdirSync(dir);
        completions.push(...files);
      } catch (err) {
        // Ignore errors reading directories
      }
    });
    const hits = completions
      .filter((c) => c.startsWith(line))
      .map((c) => (c += " "));
    if (hits.length === 0) {
      process.stdout.write("\u0007"); // Emit bell character
    }
    return [hits.length ? hits : completions, line];
  },
});
const builtins = ["type", "echo", "exit", "pwd", "cd"];

function isBuiltin(cmd) {
  return builtins.includes(cmd);
}

function redirection(tokens) {
  const stdoutIdx = tokens.findIndex((arg) => arg === ">" || arg === "1>");
  const stdoutAppendIdx = tokens.findIndex(
    (arg) => arg === ">>" || arg === "1>>"
  );
  const stderrIdx = tokens.findIndex((arg) => arg === "2>");
  const stderrAppendIdx = tokens.findIndex((arg) => arg === "2>>");
  return { stdoutIdx, stderrIdx, stderrAppendIdx, stdoutAppendIdx };
}

function parseString(inputArray) {
  const fullCommand = inputArray.join(" ");
  const parts = [];
  let current = "";
  let inDoubleQuote = false;
  let inSingleQuote = false;
  let escapeNext = false;
  let doubleEscapeNext = false;
  const escapeSequences = ["\\", "$", '"', "\n"];

  for (let i = 0; i < fullCommand.length; i++) {
    const char = fullCommand[i];

    if (escapeNext && !inSingleQuote && !inDoubleQuote) {
      current += char;
      escapeNext = false;
      continue;
    }
    if (doubleEscapeNext) {
      if (escapeSequences.includes(char)) {
        current += char;
      } else current += "\\" + char;
      doubleEscapeNext = false;
      continue;
    }

    if (char === "\\" && !inSingleQuote && !inDoubleQuote) {
      escapeNext = true;
      continue;
    }
    if (char === "\\" && inDoubleQuote) {
      doubleEscapeNext = true;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === " " && !inDoubleQuote && !inSingleQuote) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }
  return parts;
}

function findExecutable(cmd) {
  const pathDirs = (process.env.PATH || "").split(path.delimiter);

  for (const dir of pathDirs) {
    const fullPath = path.join(dir, cmd);
    try {
      fs.accessSync(fullPath, fs.constants.X_OK);
      return {
        present: true,
        fullPath,
      };
    } catch (error) {
      // Not executable or missing, continue searching PATH.
    }
  }

  return {
    present: false,
    fullPath: null,
  };
}

function handleExitCommand(tokens) {
  if (tokens.length === 1) {
    return false;
  }
  return tokens[1] === "0" ? false : true;
}

async function handleEchoCommand(tokens) {
  const { stdoutIdx, stderrIdx, stdoutAppendIdx, stderrAppendIdx } =
    redirection(tokens);
  let outputTokens = tokens.slice(1);
  let stdoutFile = null;
  let stderrFile = null;
  let appendMode = false;

  if (stdoutIdx !== -1) {
    stdoutFile = tokens[stdoutIdx + 1];
    outputTokens = tokens.slice(1, stdoutIdx);
  } else if (stderrIdx !== -1) {
    stderrFile = tokens[stderrIdx + 1];
    outputTokens = tokens.slice(1, stderrIdx);
  } else if (stdoutAppendIdx !== -1) {
    stdoutFile = tokens[stdoutAppendIdx + 1];
    outputTokens = tokens.slice(1, stdoutAppendIdx);
    appendMode = true;
  } else if (stderrAppendIdx !== -1) {
    stderrFile = tokens[stderrAppendIdx + 1];
    outputTokens = tokens.slice(1, stderrAppendIdx);
    appendMode = true;
  }

  const output = outputTokens.join(" ");

  if (stdoutFile) {
    const dir = path.dirname(stdoutFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stdoutFile, output + "\n", {
      flag: appendMode ? "a" : "w",
    });
    return true;
  }

  if (stderrFile) {
    const dir = path.dirname(stderrFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stderrFile, "");
    console.log(output);
    return true;
  }
  console.log(output);
  return true;
}

function handleTypeCommand(tokens) {
  const cmd = tokens[1];
  if (!cmd) {
    console.log("type: missing argument");
    return true;
  }

  if (isBuiltin(cmd)) {
    console.log(`${cmd} is a shell builtin`);
  } else {
    const { present, fullPath } = findExecutable(cmd);
    if (present) {
      console.log(`${cmd} is ${fullPath}`);
    } else {
      console.log(`${cmd}: not found`);
    }
  }
  return true;
}

function handlePwdCommand() {
  console.log(process.cwd());
  return true;
}

function handleCdCommand(tokens) {
  const dir = tokens[1] ? tokens[1].trim() : "~";
  try {
    process.chdir(dir === "~" ? os.homedir() : dir);
  } catch (error) {
    console.log(`cd: ${dir}: No such file or directory`);
  }
  return true;
}

async function handleExternalCommand(tokens) {
  const { stdoutIdx, stderrIdx, stdoutAppendIdx, stderrAppendIdx } =
    redirection(tokens);

  let commandTokens = tokens;
  let stdoutStream = "inherit";
  let stderrStream = "inherit";

  // Handle stdout redirection
  if (stdoutIdx !== -1 && stdoutIdx + 1 < tokens.length) {
    const filePath = tokens[stdoutIdx + 1];
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    stdoutStream = fs.openSync(filePath, "w");
    commandTokens = tokens.slice(0, stdoutIdx);
  }

  // Handle stderr redirection
  if (stderrIdx !== -1 && stderrIdx + 1 < tokens.length) {
    const filePath = tokens[stderrIdx + 1];
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    stderrStream = fs.openSync(filePath, "w");
    commandTokens = commandTokens.slice(0, stderrIdx);
  }

  if (stdoutAppendIdx !== -1 && stdoutAppendIdx + 1 < tokens.length) {
    const filePath = tokens[stdoutAppendIdx + 1];
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    stdoutStream = fs.openSync(filePath, "a");
    commandTokens = tokens.slice(0, stdoutAppendIdx);
  }

  if (stderrAppendIdx !== -1 && stderrAppendIdx + 1 < tokens.length) {
    const filePath = tokens[stderrAppendIdx + 1];
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    stderrStream = fs.openSync(filePath, "a");
    commandTokens = commandTokens.slice(0, stderrAppendIdx);
  }

  return new Promise((resolve) => {
    const [cmd, ...args] = commandTokens;
    if (!cmd) {
      resolve(true);
      return;
    }

    const child = spawn(cmd, args, {
      stdio: ["ignore", stdoutStream, stderrStream],
    });

    child.on("error", () => {
      console.log(`${cmd}: command not found`);
      if (stdoutStream !== "inherit") fs.closeSync(stdoutStream);
      if (stderrStream !== "inherit") fs.closeSync(stderrStream);
      resolve(true);
    });

    child.on("close", () => {
      if (stdoutStream !== "inherit") fs.closeSync(stdoutStream);
      if (stderrStream !== "inherit") fs.closeSync(stderrStream);
      resolve(true);
    });
  });
}

async function executeCommand(input) {
  const tokens = parseString([input]);
  if (tokens.length === 0) return true;
  const command = tokens[0];
  if (isBuiltin(command)) {
    switch (command) {
      case "exit":
        return handleExitCommand(tokens);
      case "echo":
        return handleEchoCommand(tokens);
      case "type":
        return handleTypeCommand(tokens);
      case "pwd":
        return handlePwdCommand();
      case "cd":
        return handleCdCommand(tokens);
      default:
        return await handleExternalCommand(tokens);
    }
  } else {
    return await handleExternalCommand(tokens);
  }
}

async function startShell() {
  while (true) {
    const answer = await rl.question("$ ");
    const shouldContinue = await executeCommand(answer);
    if (!shouldContinue) break;
  }
  rl.close();
}

startShell();