const readline = require('readline');

function computeNextIndex(currentIndex, direction, length) {
  if (!length || length <= 0) return 0;
  if (direction === 'up') {
    return (currentIndex - 1 + length) % length;
  }
  if (direction === 'down') {
    return (currentIndex + 1) % length;
  }
  return currentIndex;
}

function selectFromListInteractive(title, choices) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
      return resolve(choices[0]);
    }

    let selectedIndex = 0;
    const totalLines = choices.length + 1;

    const render = (isFirst = false) => {
      if (!isFirst) {
        process.stdout.write(`\x1b[${totalLines}A`);
      }
      process.stdout.write(`\x1b[2K${title}\n`);
      for (let i = 0; i < choices.length; i++) {
        const isSel = i === selectedIndex;
        const prefix = isSel ? '\x1b[36m❯\x1b[0m' : ' ';
        const text = isSel ? `\x1b[1m\x1b[36m${choices[i].label}\x1b[0m` : choices[i].label;
        process.stdout.write(`\x1b[2K  ${prefix} ${text}\n`);
      }
    };

    readline.emitKeypressEvents(process.stdin);
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write('\x1b[?25l');

    render(true);

    const cleanup = () => {
      process.stdin.removeListener('keypress', onKeypress);
      try { process.stdin.setRawMode(Boolean(wasRaw)); } catch (e) {}
      process.stdin.pause();
      process.stdout.write('\x1b[?25h');
    };

    const onKeypress = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(130);
      }

      if (key.name === 'up' || key.name === 'k') {
        selectedIndex = computeNextIndex(selectedIndex, 'up', choices.length);
        render(false);
      } else if (key.name === 'down' || key.name === 'j') {
        selectedIndex = computeNextIndex(selectedIndex, 'down', choices.length);
        render(false);
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(choices[selectedIndex]);
      }
    };

    process.stdin.on('keypress', onKeypress);
  });
}

module.exports = {
  computeNextIndex,
  selectFromListInteractive
};
