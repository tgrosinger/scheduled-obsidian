import { defaultSettings, ISettings, SettingsInstance } from './settings';
import { TaskHandler } from './task-handler';
import { TaskLine } from './task-line';
import TaskMove from './ui/TaskMove.svelte';
import TaskRepeat from './ui/TaskRepeat.svelte';
import { VaultIntermediate } from './vault';
import type { Moment } from 'moment';
import {
  App,
  MarkdownPostProcessorContext,
  MarkdownPreviewRenderer,
  MarkdownView,
  Modal,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} from 'obsidian';

// TODO: Can I use a webworker to perform a scan of files in the vault for
// tasks that would otherwise be missed and not have a repetition created?

declare global {
  interface Window {
    moment: () => Moment;
  }
}

export default class SlatedPlugin extends Plugin {
  public settings: ISettings;

  private vault: VaultIntermediate;
  private taskHandler: TaskHandler;

  private lastFile: TFile | undefined;

  public async onload(): Promise<void> {
    await this.loadSettings();

    this.vault = new VaultIntermediate(this.app.vault);
    this.taskHandler = new TaskHandler(this.vault, this.settings);

    MarkdownPreviewRenderer.registerPostProcessor(this.renderMovedTasks);

    this.registerEvent(
      this.app.workspace.on('file-open', (file: TFile) => {
        if (!file || !file.basename) {
          return;
        }

        // This callback is fired whenever a file receives focus
        // not just when the file is first opened.
        console.debug('Slated: File opened: ' + file.basename);

        if (this.lastFile) {
          this.taskHandler.processFile(this.lastFile);
        }

        this.lastFile = file;
        this.taskHandler.processFile(file);
      }),
    );

    this.addCommand({
      id: 'task-move-modal',
      name: 'Move Task',
      checkCallback: (checking: boolean) => {
        if (checking) {
          return this.taskModalChecker();
        }

        this.taskModalOpener((task: TaskLine) => {
          new TaskMoveModal(this.app, task).open();
        });
      },
    });

    this.addCommand({
      id: 'task-repeat-modal',
      name: 'Configure Task Repetition',
      checkCallback: (checking: boolean) => {
        if (checking) {
          return this.taskModalChecker();
        }

        this.taskModalOpener((task: TaskLine) => {
          new TaskRepeatModal(this.app, task).open();
        });
      },
    });

    this.addSettingTab(new SettingsTab(this.app, this));
  }

  private async loadSettings(): Promise<void> {
    const settingsOptions = Object.assign(
      defaultSettings,
      await this.loadData(),
    );
    this.settings = new SettingsInstance(settingsOptions);
  }

  private readonly taskModalChecker = (): boolean => {
    if (
      this.app.workspace.activeLeaf === undefined ||
      !(this.app.workspace.activeLeaf.view instanceof MarkdownView)
    ) {
      return false;
    }

    const activeLeaf = this.app.workspace.activeLeaf;
    if (!(activeLeaf.view instanceof MarkdownView)) {
      return;
    }

    const editor = activeLeaf.view.sourceMode.cmEditor;
    const cursorPos = editor.getCursor();
    const currentLine = editor.getLine(cursorPos.line);
    const task = new TaskLine(
      currentLine,
      cursorPos.line,
      activeLeaf.view.file,
      this.vault,
      this.settings,
    );

    return task.isTask();
  };

  private readonly taskModalOpener = (fn: (task: TaskLine) => void): void => {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (!(activeLeaf.view instanceof MarkdownView)) {
      return;
    }

    const editor = activeLeaf.view.sourceMode.cmEditor;
    const cursorPos = editor.getCursor();
    const currentLine = editor.getLine(cursorPos.line);
    const task = new TaskLine(
      currentLine,
      cursorPos.line,
      activeLeaf.view.file,
      this.vault,
      this.settings,
    );
    fn(task);
  };

  private readonly renderMovedTasks = (
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext,
  ): Promise<any> | void => {
    Object.values(el.getElementsByTagName('li'))
      .filter(
        (listItem) =>
          !listItem.hasClass('task-list-item') &&
          listItem.getText().trimLeft().startsWith('[>]'),
      )
      .forEach((listItem) => {
        for (let i = 0; i < listItem.childNodes.length; i++) {
          const child = listItem.childNodes[i];
          if (child.nodeType !== 3) {
            continue;
          }

          child.textContent = child.textContent.slice(4);
          break; // Only perform the replacement on the first textnode in an <li>
        }

        listItem.addClass('task-list-item');
        listItem.insertBefore(Element(movedIconSvg), listItem.firstChild);
      });
  };
}

class TaskMoveModal extends Modal {
  private readonly task: TaskLine;

  constructor(app: App, task: TaskLine) {
    super(app);
    this.task = task;
  }

  public onOpen = (): void => {
    const { contentEl } = this;
    const app = new TaskMove({
      target: contentEl,
      props: {
        task: this.task,
        close: () => this.close(),
      },
    });
  };

  public onClose = (): void => {
    const { contentEl } = this;
    contentEl.empty();
  };
}

class TaskRepeatModal extends Modal {
  private readonly task: TaskLine;

  constructor(app: App, task: TaskLine) {
    super(app);
    this.task = task;
  }

  public onOpen = (): void => {
    const { contentEl } = this;
    const app = new TaskRepeat({
      target: contentEl,
      props: {
        task: this.task,
        close: () => this.close(),
      },
    });
  };

  public onClose = (): void => {
    const { contentEl } = this;
    contentEl.empty();
  };
}

class SettingsTab extends PluginSettingTab {
  private readonly plugin: SlatedPlugin;

  constructor(app: App, plugin: SlatedPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  public display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Slated Plugin - Settings' });

    containerEl.createEl('p', {
      text: 'This plugin is in Alpha testing. Back up your data!',
    });
    containerEl.createEl('p', {
      text:
        'If you encounter bugs, or have feature requests, please submit them on Github.',
    });
    containerEl.createEl('p', { text: 'Thank you.' });

    new Setting(containerEl)
      .setName('Empty line after headings')
      .setDesc(
        'When creating headings or adding tasks, leave an empty line below any headings.',
      )
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.blankLineAfterHeader)
          .onChange((value) => {
            this.plugin.settings.blankLineAfterHeader = value;
            this.plugin.saveData(this.plugin.settings);
            this.display();
          });
      });

    new Setting(containerEl)
      .setName('Tasks section header')
      .setDesc(
        'Markdown header to use when creating tasks section in a document',
      )
      .addText((text) => {
        text.setValue(this.plugin.settings.tasksHeader).onChange((value) => {
          this.plugin.settings.tasksHeader = value;
          this.plugin.saveData(this.plugin.settings);
          this.display();
        });
      });

    new Setting(containerEl)
      .setName('Alias backlinks to original tasks')
      .setDesc(
        'When a task is moved or repeats, use the "Origin" alias in the backlink',
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.aliasLinks).onChange((value) => {
          this.plugin.settings.aliasLinks = value;
          this.plugin.saveData(this.plugin.settings);
          this.display();
        });
      });

    const div = containerEl.createEl('div', {
      cls: 'slated-donation',
    });

    const donateText = document.createElement('p');
    donateText.appendText(
      'If this plugin adds value for you and you would like to help support ' +
        'continued development, please use the buttons below:',
    );
    div.appendChild(donateText);

    div.appendChild(
      createDonateButton(
        'https://paypal.me/tgrosinger',
        'PayPal.Me',
        'https://www.paypalobjects.com/webstatic/en_US/i/buttons/PP_logo_h_150x38.png',
      ),
    );

    div.appendChild(
      createDonateButton(
        'https://www.buymeacoffee.com/tgrosinger',
        'Buy Me a Coffee',
        'https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png',
      ),
    );
  }
}

const createDonateButton = (
  link: string,
  name: string,
  imgURL: string,
): HTMLElement => {
  const a = document.createElement('a');
  a.setAttribute('href', link);
  a.addClass('slated-donate-button');

  const img = document.createElement('img');
  img.setAttribute('width', '150px');
  img.setAttribute('src', imgURL);
  img.setText(name);

  a.appendChild(img);
  return a;
};

const Element = (svgText: string): HTMLElement => {
  const parser = new DOMParser();
  return parser.parseFromString(svgText, 'text/xml').documentElement;
};

const movedIconSvg = `
<svg width="67.866mm" height="50.848mm" class="slated-moved-icon" version="1.1" viewBox="0 0 67.866 50.848" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(-50.611 -68.117)" stroke-width=".26458">
    <path d="m56.615 118.92c-4.5671 0.0484-5.974-1.0747-6.0043-5.5592v-39.688c0.01-3.8019 2.0865-5.4819 5.2642-5.5364 11.175 0.10653 26.2-0.08758 35.457 0.08419 3.6164-0.06727 5.2053 1.6289 5.2438 4.6986 0.02617 2.0882 0.13364 6.5772-0.02553 7.8988-0.61614 1.1441-1.8806 1.63-2.9574 1.184-1.2363-0.5121-1.5737-1.4519-1.5844-4.4135-0.01029-2.844-0.23871-3.5193-1.4637-4.3268-0.74559-0.4915-1.4066-0.51151-16.915-0.51224-15.542-7.1e-4 -16.171 0.0184-16.987 0.51573-1.7551 1.0701-1.6845 0.16208-1.6056 20.666l0.0714 18.544c0.17042 1.4314 0.17554 1.7322 1.9766 1.8112h16.289c17.588 0 17.372 0.0165 18.17-1.3918 0.1848-0.32591 0.39797-1.8839 0.47373-3.4622 0.13278-2.7663 0.16551-2.8935 0.90875-3.5328 0.61747-0.53113 0.95623-0.63314 1.7011-0.51226 1.7833 0.28939 2.021 0.81763 2.0133 4.4758-0.09917 5.1366-1.3983 8.9788-6.0786 9.0536-11.227 0.0696-23.822 0.0172-33.948 3e-3z"/>
    <path d="m104 105.42c-0.634-0.44406-1.0023-1.6908-0.74188-2.5113 0.0941-0.29655 1.0257-1.2579 2.0702-2.1363 1.8153-1.5407 3.9542-3.3059 5.471-4.7597 0-0.15376-6.4391-0.24958-16.772-0.24958-18.788 0-15.484-0.03127-16.684-0.01001-1.3917 0.0023-1.364-4.2961-0.1613-4.2877 1.4115-0.05846 16.927-0.20021 16.927-0.20021 9.1787-0.07519 16.683-0.0893 16.675-0.19843-8e-3 -0.10914-1.6109-1.5081-3.5626-3.1089-1.9517-1.6007-3.6852-3.2355-3.8524-3.6329-0.61169-1.4545 0.46544-3.114 2.0212-3.114 0.94385 0 1.4823 0.39939 8.0942 6.0037 4.3651 3.6999 4.9865 4.5014 4.9865 6.4317 0 2.0359-0.53697 2.6642-6.4524 7.5502-4.889 4.0382-5.7026 4.6144-6.5194 4.6173-0.51333 2e-3 -1.1885-0.17543-1.5004-0.39389z"/>
  </g>
</svg>`;
