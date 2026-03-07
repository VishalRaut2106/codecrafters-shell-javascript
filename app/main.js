import readline from "readline";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const builtInCommands = {
  echo: true,
  exit: true,
  type: true,
  pwd: true,
  cd: true,
}

const handleExit = () => {
  rl.close();
}

const handleEcho = (args) => {
  const output = args.join(' ');
  console.log(output);
}

const handlePwd = () => {
  console.log(process.cwd());
}

const handleCd = (path) => {
  try {
    process.chdir(path[0] === '~' ? process.env.HOME : path);
  } catch {
    console.log(`cd: ${path}: No such file or directory`)
  }
}

const getPaths = () => process.env.PATH.split(path.delimiter);

const handleType = (command) => {
  if (command in builtInCommands) {
    console.log(`${command} is a shell builtin`);
    return;
  }

  const paths = getPaths();

  for (const concretePath of paths) {
    const accessPath = `${concretePath}/${command}`;

    try {
      fs.accessSync(accessPath, fs.constants.F_OK | fs.constants.X_OK);
      console.log(`${command} is ${accessPath}`);
      return;
    } catch (err) {}
  }

  console.log(`${command}: not found`);
}

const handleCommands = (answer) => {
  const args = answer.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) || [];
  const command = args.shift().replace(/['"]/g, '');
  const cleanedArgs = args.map(arg => arg.replace(/'([^']*)'|"([^"]*)"/g, (_, p1, p2) => p1 ?? p2));

  switch (command) {
    case 'exit':
      handleExit();
      return true;
    case 'echo':
      handleEcho(cleanedArgs);
      return false;
    case 'pwd':
      handlePwd();
      return false;
    case 'cd':
      handleCd(cleanedArgs.join(''))
      return false;
    case 'type':
      handleType(args[0]);
      return false;
    default:
      const { status } = spawnSync(command, cleanedArgs, { encoding: 'utf-8', stdio: 'inherit' });
      if (status !== 0) {
        console.log(`${command}: command not found`);
      }
      return false;
  }
}

const recursiveQuestion = () => {
  rl.question("$ ", (answer) => {
    const isClosed = handleCommands(answer);
    if (!isClosed) recursiveQuestion();
  });
};

recursiveQuestion();
