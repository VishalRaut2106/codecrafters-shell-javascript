const readline = require("readline");
const fs = require("fs");
const { spawn } = require("child_process");
const {
  computeAbsolutePath,
  tokenizeCommand,
  groupTokens,
} = require("./utility");
const { completer } = require("./readline/completer");
const { BUILTIN_COMMANDS, EXTERNAL_COMMANDS } = require("./constants");
const logger = require("./logger");
const { PassThrough } = require("stream");

const commandHistory = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
  completer: completer,
});

rl.prompt();

rl.on("line", async (command) => {
  commandHistory.push(`\t${commandHistory.length + 1} ${command}`);
  const tokens = tokenizeCommand(command);
  const groupedTokens = groupTokens(tokens);

  let stdin = null;
  let childStdout = null;

  for (let i = 0; i < groupedTokens.length; i++) {
    if (i === groupedTokens.length - 1) {
      childStdout = await mainFn(groupedTokens[i], stdin, true);
      break;
    }

    childStdout = await mainFn(groupedTokens[i], stdin);
    stdin = childStdout;
  }

  rl.prompt();
});

async function mainFn(words, stdin, isFinalCommand = false) {
  const outStream = new PassThrough();
  if (isFinalCommand) {
    outStream.pipe(process.stdout);
  }

  let outputFd = 0;
  const outputIdx = words.findIndex(
    (word) => word === ">" || word === "1>" || word === ">>" || word === "1>>",
  );
  if (outputIdx > -1) {
    const outputFile = computeAbsolutePath(words[outputIdx + 1]);

    if (words[outputIdx] === ">" || words[outputIdx] === "1>") {
      outputFd = fs.openSync(outputFile, "w");
    } else {
      outputFd = fs.openSync(outputFile, "a");
    }

    words = words.slice(0, outputIdx);
  }

  const out = outputFd ? outputFd : outStream;

  let errorFd = 0;
  const errorIdx = words.findIndex((word) => word === "2>" || word === "2>>");
  if (errorIdx > -1) {
    const errorFile = computeAbsolutePath(words[errorIdx + 1]);

    if (words[errorIdx] === "2>") {
      errorFd = fs.openSync(errorFile, "w");
    } else {
      errorFd = fs.openSync(errorFile, "a");
    }

    words = words.slice(0, errorIdx);
  }

  switch (words[0]) {
    case "exit":
      process.exit();
    case "pwd":
      logger.log(process.cwd(), out);
      break;
    case "cd":
      const absolutePath = computeAbsolutePath(words[1]);

      if (fs.existsSync(absolutePath)) {
        process.chdir(absolutePath);
      } else {
        logger.error(`cd: ${words[1]}: No such file or directory`, errorFd);
      }

      break;
    case "echo":
      logger.log(words.slice(1).join(" "), out);
      break;
    case "type":
      if (BUILTIN_COMMANDS.includes(words[1])) {
        logger.log(`${words[1]} is a shell builtin`, out);
      } else {
        const result = words[1] in EXTERNAL_COMMANDS;

        if (result) {
          logger.log(`${words[1]} is ${EXTERNAL_COMMANDS[words[1]]}`, out);
        } else {
          logger.error(`${words[1]}: not found`, errorFd);
        }
      }
      break;
    case "history":
      logger.log(commandHistory.slice(-words[1]).join("\n"), out);
      break;
    default:
      const result = words[0] in EXTERNAL_COMMANDS;
      if (result) {
        try {
          const spawnOptions = {
            stdio: ["pipe", isFinalCommand ? "inherit" : "pipe", "inherit"],
            cwd: process.cwd(),
          };

          if (outputFd) {
            spawnOptions.stdio[1] = outputFd;
          }
          if (errorFd) {
            spawnOptions.stdio[2] = errorFd;
          }

          const childProcess = spawn(words[0], words.slice(1), spawnOptions);
          // preventing pipeing during first iteration since it causes all sorts of edge cases
          if (stdin) {
            stdin.pipe(childProcess.stdin);
          }

          if (outputFd) {
            fs.closeSync(spawnOptions.stdio[1]);
          }
          if (errorFd) {
            fs.closeSync(spawnOptions.stdio[2]);
          }

          if (isFinalCommand) {
            await new Promise((resolve, reject) => {
              childProcess.once("close", () => {
                resolve();
              });
            });
          }

          return childProcess.stdout;
        } catch (error) {
          console.log(error);
        }
      } else {
        logger.error(`${words.join(" ")}: command not found`, errorFd);
      }
      break;
  }

  outStream.end();
  return outStream;
}
