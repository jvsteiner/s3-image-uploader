import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"
import * as mime from 'mime-types';
import * as crypto from 'crypto';

import {
	Notice,
	Plugin,
	Editor,
	MarkdownView,
	EditorPosition,
} from "obsidian";

  // Remember to rename these classes and interfaces!

interface pasteFunction {
	(this: HTMLElement, event: ClipboardEvent): void;
}

interface S3UploaderSettings {
	accessKey: string;
	secretKey: string;
	region: string;
	bucket: string;
	folder: string;
	apiEndpoint: string;
	uploadHeader: string;
	uploadBody: string;
	imageUrlPath: string;
	maxWidth: number;
}

const DEFAULT_SETTINGS: S3UploaderSettings = {
	accessKey: '',
	secretKey: '',
	region: '',
	bucket: '',
	folder: '',
	apiEndpoint: null,
	uploadHeader: null,
	uploadBody: "{\"image\": \"$FILE\"}",
	imageUrlPath: null,
	maxWidth: 4096,
}

export default class MyPlugin extends Plugin {
	settings: S3UploaderSettings;
	s3: S3Client;
	pasteFunction: pasteFunction;

	private replaceText(editor: Editor, target: string, replacement: string): void {
		target = target.trim()
		const lines = editor.getValue().split("\n");
		for (let i = 0; i < lines.length; i++) {
			const ch = lines[i].indexOf(target)
			if (ch !== -1) {
				const from = { line: i, ch: ch } as EditorPosition;
				const to = { line: i, ch: ch + target.length } as EditorPosition;
				editor.setCursor(from);
				editor.replaceRange(replacement, from, to);
				break;
			}
		}
	}

	async pasteHandler(ev: ClipboardEvent, editor: Editor, mkView: MarkdownView): Promise<void> {
		if (ev.defaultPrevented) {
			console.log("paste event is canceled");
			return;
		}
	
		let file = ev.clipboardData.files[0];

		const imageType = /image.*/;
		if (file.type.match(imageType)) {
	
			ev.preventDefault();
	
			// set the placeholder text
			const buf = await file.arrayBuffer()
			const digest = crypto.createHash('md5').update(new Uint8Array(buf)).digest("hex");
			const contentType = mime.lookup(file.name);
			const newFileName = digest+"."+mime.extension(contentType);
			const pastePlaceText = `![uploading...](${newFileName})\n`
			editor.replaceSelection(pastePlaceText)
	
			// upload the image
			const key = this.settings.folder ? "/" + newFileName : newFileName;
			this.s3.send(new PutObjectCommand({
				Bucket: this.settings.bucket,
				Key: key,
				Body: file,
				ContentType: contentType,
			})).then(res => {
				const url = this.settings.imageUrlPath + key;
				const imgMarkdownText = `![image](${url})`
				this.replaceText(editor, pastePlaceText, imgMarkdownText)
			}).catch(err => {
				console.log(err);
			});
		}
	}

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('This is a notice!');
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');


		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new S3UploaderSettingTab(this.app, this));

		this.settings.apiEndpoint = `https://s3.${this.settings.region}.amazonaws.com/`;
		this.settings.imageUrlPath = `https://${this.settings.bucket}.s3.${this.settings.region}.amazonaws.com/`;
		this.s3 = new S3Client({
			region: this.settings.region,
			credentials: {
				accessKeyId: this.settings.accessKey,
				secretAccessKey: this.settings.secretKey,
			},
			endpoint: this.settings.apiEndpoint,
		});

		this.pasteFunction = this.pasteHandler.bind(this);

		this.registerEvent(
			this.app.workspace.on('editor-paste', this.pasteFunction)
		);
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Jamie!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class S3UploaderSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings for s3 Image Uploader.'});

		new Setting(containerEl)
			.setName('AWS Access Key')
			.setDesc('aws access key')
			.addText(text => text
				.setPlaceholder('access key')
				.setValue(this.plugin.settings.accessKey)
				.onChange(async (value) => {
					console.log('ID: ' + value);
					this.plugin.settings.accessKey = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
		.setName('AWS Secret Key')
		.setDesc('aws secret key')
		.addText(text => text
			.setPlaceholder('secret key')
			.setValue(this.plugin.settings.secretKey)
			.onChange(async (value) => {
				console.log('Secret: ' + value);
				this.plugin.settings.secretKey = value;
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl)
		.setName('Region')
		.setDesc('aws region')
		.addText(text => text
			.setPlaceholder('aws region')
			.setValue(this.plugin.settings.region)
			.onChange(async (value) => {
				console.log('Region: ' + value);
				this.plugin.settings.region = value;
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl)
		.setName('s3 Bucket')
		.setDesc('s3 bucket name')
		.addText(text => text
			.setPlaceholder('bucket name')
			.setValue(this.plugin.settings.bucket)
			.onChange(async (value) => {
				console.log('Bucket: ' + value);
				this.plugin.settings.bucket = value;
				await this.plugin.saveSettings();
			}));
		new Setting(containerEl)
		.setName('bucket folder')
		.setDesc('optional folder in s3 bucket')
		.addText(text => text
			.setPlaceholder('folder')
			.setValue(this.plugin.settings.folder)
			.onChange(async (value) => {
				console.log('Folder: ' + value);
				this.plugin.settings.folder = value;
				await this.plugin.saveSettings();
			}));
		}
}
