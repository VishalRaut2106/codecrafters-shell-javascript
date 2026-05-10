const path = require("path");
const os = require("os");

function tokenizeCommand(command) {
  const tokens = [];
  let currentToken = "";
  let inDoubleQuotes = false;
  let inSingleQuotes = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    const nextChar = command[i + 1];

    if (char === '"' && !inSingleQuotes) {
      inDoubleQuotes = !inDoubleQuotes;
      // Don't add the quote character to the token
    } else if (char === "'" && !inDoubleQuotes) {
      inSingleQuotes = !inSingleQuotes;
      // Don't add the quote character to the token
    } else if (char === "\\" && inDoubleQuotes) {
      // Backslash in double quotes - escape the next character
      if (nextChar) {
        currentToken += nextChar;
        i++; // Skip the next character
      } else {
        currentToken += char;
      }
    } else if ((char === " " || char === "\t") && !inDoubleQuotes && !inSingleQuotes) {
      if (currentToken) {
        tokens.push(currentToken);
        currentToken = "";
      }
    } else {
      currentToken += char;
    }
  }

  if (currentToken) {
    tokens.push(currentToken);
  }

  return tokens;
}

function groupTokens(tokens) {
  const groups = [];
  let currentGroup = [];

  for (const token of tokens) {
    if (token === "|") {
      if (currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
      }
    } else {
      currentGroup.push(token);
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

function computeAbsolutePath(pathStr) {
  if (!pathStr) {
    return process.cwd();
  }

  // Handle home directory
  if (pathStr.startsWith("~")) {
    pathStr = pathStr.replace("~", os.homedir());
  }

  // If already absolute, return as is
  if (path.isAbsolute(pathStr)) {
    return pathStr;
  }

  // Resolve relative to current working directory
  return path.resolve(process.cwd(), pathStr);
}

module.exports = {
  tokenizeCommand,
  groupTokens,
  computeAbsolutePath,
};
