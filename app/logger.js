const fs = require("fs");

function log(message, fd) {
  if (typeof fd === "number" && fd > 0) {
    // Write to file descriptor
    fs.writeSync(fd, message + "\n");
  } else if (fd && typeof fd.write === "function") {
    // Write to stream
    fd.write(message + "\n");
  } else {
    // Write to stdout
    console.log(message);
  }
}

function error(message, fd) {
  if (typeof fd === "number" && fd > 0) {
    // Write to file descriptor
    fs.writeSync(fd, message + "\n");
  } else if (fd && typeof fd.write === "function") {
    // Write to stream
    fd.write(message + "\n");
  } else {
    // Write to stderr
    console.error(message);
  }
}

module.exports = { log, error };
