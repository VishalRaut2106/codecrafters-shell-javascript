async function mainFn(words, stdin, isFinalCommand = false) {
  const outStream = new PassThrough();
  if (isFinalCommand) outStream.pipe(process.stdout);

  let stdoutFd = null;
  let stderrFd = null;

  // ✅ STDOUT redirection
  let idx = words.findIndex(w => [">", "1>", ">>", "1>>"].includes(w));
  if (idx !== -1) {
    const file = computeAbsolutePath(words[idx + 1]);

    stdoutFd = words[idx].includes(">>")
      ? fs.openSync(file, "a")
      : fs.openSync(file, "w");

    words.splice(idx, 2); // ✅ REMOVE operator + file
  }

  // ✅ STDERR redirection
  idx = words.findIndex(w => ["2>", "2>>"].includes(w));
  if (idx !== -1) {
    const file = computeAbsolutePath(words[idx + 1]);

    stderrFd = words[idx] === "2>>"
      ? fs.openSync(file, "a")
      : fs.openSync(file, "w");

    words.splice(idx, 2); // ✅ REMOVE operator + file
  }

  switch (words[0]) {
    case "exit":
      process.exit();

    case "pwd":
      logger.log(process.cwd(), stdoutFd ?? outStream);
      break;

    case "cd":
      const p = computeAbsolutePath(words[1]);
      if (fs.existsSync(p)) process.chdir(p);
      else logger.error(`cd: ${words[1]}: No such file or directory`, stderrFd ?? process.stderr);
      break;

    case "echo":
      logger.log(words.slice(1).join(" "), stdoutFd ?? outStream);
      break;

    case "type":
      if (BUILTIN_COMMANDS.includes(words[1])) {
        logger.log(`${words[1]} is a shell builtin`, stdoutFd ?? outStream);
      } else {
        const cmd = resolveExternalCommand(words[1]);
        if (cmd) {
          logger.log(`${words[1]} is ${cmd}`, stdoutFd ?? outStream);
        } else {
          logger.error(`${words[1]}: not found`, stderrFd ?? process.stderr);
        }
      }
      break;

    case "history":
      const count = words[1] ? parseInt(words[1], 10) : commandHistory.length;
      const start = Math.max(0, commandHistory.length - count);

      const history = commandHistory
        .slice(start)
        .map((cmd, i) => `${(start + i + 1).toString().padStart(5)}  ${cmd}`)
        .join("\n");

      if (history) logger.log(history, stdoutFd ?? outStream);
      break;

    default:
      try {
        const child = spawn(words[0], words.slice(1), {
          stdio: [
            "pipe",
            stdoutFd !== null ? stdoutFd : (isFinalCommand ? "inherit" : "pipe"),
            stderrFd !== null ? stderrFd : "inherit"
          ],
          cwd: process.cwd(),
          env: process.env,
        });

        child.on("error", () => {
          logger.error(`${words.join(" ")}: command not found`, stderrFd ?? process.stderr);
        });

        if (stdin && child.stdin) stdin.pipe(child.stdin);

        if (isFinalCommand) {
          await new Promise(res => child.on("close", res));
        }

        if (stdoutFd !== null) fs.closeSync(stdoutFd);
        if (stderrFd !== null) fs.closeSync(stderrFd);

        return child.stdout || outStream;

      } catch {
        logger.error(`${words.join(" ")}: command not found`, stderrFd ?? process.stderr);
      }
  }

  outStream.end();
  return outStream;
}