const vscode = require('vscode');
const path = require('path');
const { exec } = require('child_process');

function activate(context) {
  let disposable = vscode.commands.registerCommand('extension.runProfiler', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No active file to profile.');
      return;
    }

    const filepath = editor.document.fileName;
    const scriptPath = path.join(context.extensionPath, 'profiler', 'universal_profiler.py');

    vscode.window.showInformationMessage(`Running profiler on ${filepath}...`);

    const cmd = `python3 "${scriptPath}" "${filepath}"`;
    const terminal = vscode.window.createTerminal("Universal Profiler");
    terminal.show();
    terminal.sendText(cmd);
  });

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
