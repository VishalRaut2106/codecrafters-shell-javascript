const readline = require("readline");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

let rlGlobal = null;
let lastLine = null;
let lastMatches = null;

function completer(line) {
  const builtins = ["cd", "echo", "exit", "pwd", "type"];
  
  if (!line.includes(' ')) {
    let hits = builtins.filter((cmd) => cmd.startsWith(line));
    
    const pathEnv = process.env.PATH || "";
    const directories = pathEnv.split(path.delimiter);
    const foundExecutables = new Set();
    
    for (const dir of directories) {
      try {
        if (!fs.existsSync(dir)) continue;
        
        const files = fs.readdirSync(dir);
        
        for (const file of files) {
          if (file.startsWith(line)) {
            const fullPath = path.join(dir, file);
            
            try {
              fs.accessSync(fullPath, fs.constants.X_OK);
              // Avoid duplicates with builtins
              if (!builtins.includes(file)) {
                foundExecutables.add(file);
              }
            } catch (err) {
              continue;
            }
          }
        }
      } catch (err) {
        continue;
      }
    }
    
    hits = hits.concat(Array.from(foundExecutables));
    hits.sort();
    
    // Remove duplicates
    hits = [...new Set(hits)];
    
    if (hits.length === 0) {
      if (rlGlobal && rlGlobal.output) {
        rlGlobal.output.write('\x07');
      } else {
        process.stdout.write('\x07');
      }
      lastLine = null;
      lastMatches = null;
      return [[], line];
    }
    
    if (hits.length === 1) {
      lastLine = null;
      lastMatches = null;
      // Return the match with a trailing space
      return [[hits[0] + ' '], line];
    }
    
    let commonPrefix = hits[0];
    for (let i = 1; i < hits.length; i++) {
      let j = 0;
      while (j < commonPrefix.length && j < hits[i].length && commonPrefix[j] === hits[i][j]) {
        j++;
      }
      commonPrefix = commonPrefix.substring(0, j);
    }
    
    if (commonPrefix.length > line.length) {
      lastLine = null;
      lastMatches = null;
      return [[commonPrefix], line];
    }
    
    if (lastLine === line && lastMatches && JSON.stringify(lastMatches) === JSON.stringify(hits)) {
      console.log();
      console.log(hits.join('  '));
      if (rlGlobal) {
        rlGlobal._refreshLine();
      }
      lastLine = null;
      lastMatches = null;
      return [[], line];
    }
    
    if (rlGlobal && rlGlobal.output) {
      rlGlobal.output.write('\x07');
    } else {
      process.stdout.write('\x07');
    }
    lastLine = line;
    lastMatches = hits;
    return [[], line];
  }
  
  lastLine = null;
  lastMatches = null;
  return [[], line];
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  completer: completer,
  terminal: true
});

rlGlobal = rl;

function findExecutableInPath(command) {
  const pathEnv = process.env.PATH || "";
  const directories = pathEnv.split(path.delimiter);
  
  for (const dir of directories) {
    const fullPath = path.join(dir, command);
    
    try {
      if (fs.existsSync(fullPath)) {
        try {
          fs.accessSync(fullPath, fs.constants.X_OK);
          return fullPath;
        } catch (err) {
          continue;
        }
      }
    } catch (err) {
      continue;
    }
  }
  
  return null;
}

function parseCommandLine(commandLine) {
  const args = [];
  let currentArg = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let redirectOutput = null;
  let redirectError = null;
  let appendOutput = null;
  let appendError = null;
  let i = 0;
  
  while (i < commandLine.length) {
    const char = commandLine[i];
    
    if (char === '\\' && !inSingleQuote && inDoubleQuote) {
      i++;
      if (i < commandLine.length) {
        const nextChar = commandLine[i];
        if (nextChar === '"' || nextChar === '\\' || nextChar === '$' || nextChar === '`') {
          currentArg += nextChar;
          i++;
        } else {
          currentArg += '\\' + nextChar;
          i++;
        }
      }
    } else if (char === '\\' && !inSingleQuote && !inDoubleQuote) {
      i++;
      if (i < commandLine.length) {
        currentArg += commandLine[i];
        i++;
      }
    } else if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      i++;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      i++;
    } else if (char === '>' && !inSingleQuote && !inDoubleQuote) {
      if (i + 1 < commandLine.length && commandLine[i + 1] === '>') {
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }
        i += 2;
        while (i < commandLine.length && (commandLine[i] === ' ' || commandLine[i] === '\t')) {
          i++;
        }
        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;
        while (i < commandLine.length) {
          const c = commandLine[i];
          if ((c === '"' || c === "'") && !inFileQuote) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (c === fileQuoteChar && inFileQuote) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if ((c === ' ' || c === '\t') && !inFileQuote) {
            break;
          } else {
            filename += c;
            i++;
          }
        }
        appendOutput = filename;
      } else {
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }
        i++;
        while (i < commandLine.length && (commandLine[i] === ' ' || commandLine[i] === '\t')) {
          i++;
        }
        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;
        while (i < commandLine.length) {
          const c = commandLine[i];
          if ((c === '"' || c === "'") && !inFileQuote) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (c === fileQuoteChar && inFileQuote) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if ((c === ' ' || c === '\t') && !inFileQuote) {
            break;
          } else {
            filename += c;
            i++;
          }
        }
        redirectOutput = filename;
      }
    } else if (char === '2' && !inSingleQuote && !inDoubleQuote && i + 1 < commandLine.length && commandLine[i + 1] === '>') {
      if (i + 2 < commandLine.length && commandLine[i + 2] === '>') {
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }
        i += 3;
        while (i < commandLine.length && (commandLine[i] === ' ' || commandLine[i] === '\t')) {
          i++;
        }
        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;
        while (i < commandLine.length) {
          const c = commandLine[i];
          if ((c === '"' || c === "'") && !inFileQuote) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (c === fileQuoteChar && inFileQuote) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if ((c === ' ' || c === '\t') && !inFileQuote) {
            break;
          } else {
            filename += c;
            i++;
          }
        }
        appendError = filename;
      } else {
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }
        i += 2;
        while (i < commandLine.length && (commandLine[i] === ' ' || commandLine[i] === '\t')) {
          i++;
        }
        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;
        while (i < commandLine.length) {
          const c = commandLine[i];
          if ((c === '"' || c === "'") && !inFileQuote) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (c === fileQuoteChar && inFileQuote) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if ((c === ' ' || c === '\t') && !inFileQuote) {
            break;
          } else {
            filename += c;
            i++;
          }
        }
        redirectError = filename;
      }
    } else if (char === '1' && !inSingleQuote && !inDoubleQuote && i + 1 < commandLine.length && commandLine[i + 1] === '>') {
      if (i + 2 < commandLine.length && commandLine[i + 2] === '>') {
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }
        i += 3;
        while (i < commandLine.length && (commandLine[i] === ' ' || commandLine[i] === '\t')) {
          i++;
        }
        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;
        while (i < commandLine.length) {
          const c = commandLine[i];
          if ((c === '"' || c === "'") && !inFileQuote) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (c === fileQuoteChar && inFileQuote) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if ((c === ' ' || c === '\t') && !inFileQuote) {
            break;
          } else {
            filename += c;
            i++;
          }
        }
        appendOutput = filename;
      } else {
        if (currentArg.length > 0) {
          args.push(currentArg);
          currentArg = "";
        }
        i += 2;
        while (i < commandLine.length && (commandLine[i] === ' ' || commandLine[i] === '\t')) {
          i++;
        }
        let filename = "";
        let inFileQuote = false;
        let fileQuoteChar = null;
        while (i < commandLine.length) {
          const c = commandLine[i];
          if ((c === '"' || c === "'") && !inFileQuote) {
            inFileQuote = true;
            fileQuoteChar = c;
            i++;
          } else if (c === fileQuoteChar && inFileQuote) {
            inFileQuote = false;
            fileQuoteChar = null;
            i++;
          } else if ((c === ' ' || c === '\t') && !inFileQuote) {
            break;
          } else {
            filename += c;
            i++;
          }
        }
        redirectOutput = filename;
      }
    } else if ((char === " " || char === "\t") && !inSingleQuote && !inDoubleQuote) {
      if (currentArg.length > 0) {
        args.push(currentArg);
        currentArg = "";
      }
      i++;
    } else {
      currentArg += char;
      i++;
    }
  }
  
  if (currentArg.length > 0) {
    args.push(currentArg);
  }
  
  return { args, redirectOutput, redirectError, appendOutput, appendError };
}

function executeCommand(commandLine) {
  const parsed = parseCommandLine(commandLine.trim());
  const parts = parsed.args;
  const redirectOutput = parsed.redirectOutput;
  const redirectError = parsed.redirectError;
  const appendOutput = parsed.appendOutput;
  const appendError = parsed.appendError;
  
  if (parts.length === 0) {
    return;
  }
  
  const command = parts[0];
  const args = parts.slice(1);
  
  const executablePath = findExecutableInPath(command);
  
  if (!executablePath) {
    console.log(`${command}: command not found`);
    return;
  }
  
  const spawnOptions = {
    argv0: command,
  };
  
  let stdoutFd = 'inherit';
  let stderrFd = 'inherit';
  
  try {
    if (redirectOutput) {
      const dir = path.dirname(redirectOutput);
      if (dir && dir !== '.' && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      stdoutFd = fs.openSync(redirectOutput, 'w');
    } else if (appendOutput) {
      const dir = path.dirname(appendOutput);
      if (dir && dir !== '.' && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      stdoutFd = fs.openSync(appendOutput, 'a');
    }
    
    if (redirectError) {
      const dir = path.dirname(redirectError);
      if (dir && dir !== '.' && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      stderrFd = fs.openSync(redirectError, 'w');
    } else if (appendError) {
      const dir = path.dirname(appendError);
      if (dir && dir !== '.' && !fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      stderrFd = fs.openSync(appendError, 'a');
    }
    
    spawnOptions.stdio = ['inherit', stdoutFd, stderrFd];
    
    const result = spawnSync(executablePath, args, spawnOptions);
    
    if (result.error) {
      console.log(`${command}: command not found`);
    }
  } finally {
    // Close file descriptors to prevent leaks
    if (typeof stdoutFd === 'number') {
      fs.closeSync(stdoutFd);
    }
    if (typeof stderrFd === 'number') {
      fs.closeSync(stderrFd);
    }
  }
}

function prompt() {
  rl.question("$ ", (command) => {
    const trimmedCommand = command.trim();
    
    // Handle exit with optional code
    if (trimmedCommand === "exit" || trimmedCommand.startsWith("exit ")) {
      const parts = trimmedCommand.split(/\s+/);
      const exitCode = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
      process.exit(exitCode);
    }
    
    // Handle pwd builtin
    if (trimmedCommand === "pwd") {
      console.log(process.cwd());
      prompt();
      return;
    }
    
    // Handle cd builtin
    if (trimmedCommand === "cd" || trimmedCommand.startsWith("cd ")) {
      const parsed = parseCommandLine(trimmedCommand);
      const parts = parsed.args;
      
      let targetDir;
      if (parts.length === 1) {
        // cd with no args goes to HOME
        targetDir = process.env.HOME || '/';
      } else if (parts[1] === '~') {
        targetDir = process.env.HOME || '/';
      } else if (parts[1].startsWith('~/')) {
        targetDir = path.join(process.env.HOME || '/', parts[1].slice(2));
      } else {
        targetDir = parts[1];
      }
      
      try {
        process.chdir(targetDir);
      } catch (err) {
        console.log(`cd: ${targetDir}: No such file or directory`);
      }
      prompt();
      return;
    }
    
    // Handle echo builtin
    if (trimmedCommand.startsWith("echo ") || trimmedCommand === "echo") {
      const parsed = parseCommandLine(trimmedCommand);
      const parts = parsed.args;
      const redirectOutput = parsed.redirectOutput;
      const redirectError = parsed.redirectError;
      const appendOutput = parsed.appendOutput;
      const appendError = parsed.appendError;
      
      let output = "";
      if (parts.length > 1) {
        output = parts.slice(1).join(" ");
      }
      
      if (redirectOutput) {
        const dir = path.dirname(redirectOutput);
        if (dir && dir !== '.' && !fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(redirectOutput, output + '\n');
      } else if (appendOutput) {
        const dir = path.dirname(appendOutput);
        if (dir && dir !== '.' && !fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.appendFileSync(appendOutput, output + '\n');
      } else {
        console.log(output);
      }
      
      if (redirectError) {
        fs.writeFileSync(redirectError, '');
      } else if (appendError) {
        fs.appendFileSync(appendError, '');
      }
      
      prompt();
      return;
    }
    
    // Handle type builtin
    if (trimmedCommand.startsWith("type ")) {
      const arg = trimmedCommand.slice(5).trim();
      const builtins = ["cd", "echo", "exit", "pwd", "type"];
      
      if (builtins.includes(arg)) {
        console.log(`${arg} is a shell builtin`);
      } else {
        const executablePath = findExecutableInPath(arg);
        
        if (executablePath) {
          console.log(`${arg} is ${executablePath}`);
        } else {
          console.log(`${arg}: not found`);
        }
      }
      prompt();
      return;
    }
    
    // Try to execute as external command
    executeCommand(trimmedCommand);
    
    prompt();
  });
}

// Start the REPL
prompt();