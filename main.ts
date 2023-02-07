import {
	App,
	Editor,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TextComponent,
	EditorPosition,
	setIcon,
} from "obsidian";

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import * as crypto from "crypto";

// Remember to rename these classes and interfaces!

interface pasteFunction {
	(this: HTMLElement, event: ClipboardEvent | DragEvent): void;
}

interface S3UploaderSettings {
	accessKey: string;
	secretKey: string;
	region: string;
	bucket: string;
	folder: string;
	apiEndpoint: string;
	imageUrlPath: string;
	uploadOnDrag: boolean;
	localUpload: boolean;
	localUploadFolder: string;
}

const DEFAULT_SETTINGS: S3UploaderSettings = {
	accessKey: "",
	secretKey: "",
	region: "",
	bucket: "",
	folder: "",
	apiEndpoint: "",
	imageUrlPath: "",
	uploadOnDrag: true,
	localUpload: false,
	localUploadFolder: "",
};

export default class S3UploaderPlugin extends Plugin {
	settings: S3UploaderSettings;
	s3: S3Client;
	pasteFunction: pasteFunction;

	private replaceText(
		editor: Editor,
		target: string,
		replacement: string
	): void {
		target = target.trim();
		const lines = editor.getValue().split("\n");
		for (let i = 0; i < lines.length; i++) {
			const ch = lines[i].indexOf(target);
			if (ch !== -1) {
				const from = { line: i, ch: ch } as EditorPosition;
				const to = {
					line: i,
					ch: ch + target.length,
				} as EditorPosition;
				editor.setCursor(from);
				editor.replaceRange(replacement, from, to);
				break;
			}
		}
	}

	async pasteHandler(
		ev: ClipboardEvent | DragEvent,
		editor: Editor
	): Promise<void> {
		if (ev.defaultPrevented) {
			return;
		}

		const noteFile = this.app.workspace.getActiveFile();

		if (!noteFile || !noteFile.name) return;

		// Handle frontmatter settings
		const fm = this.app.metadataCache.getFileCache(noteFile)?.frontmatter;
		const fmUploadOnDrag = fm && fm.uploadOnDrag;
		const fmLocalUpload = fm && fm.localUpload;
		const fmUploadFolder = fm ? fm.localUploadFolder : null;

		const localUpload = fmLocalUpload
			? fmLocalUpload
			: this.settings.localUpload;

		let file = null;

		// figure out what kind of event we're handling
		switch (ev.type) {
			case "paste":
				file = (ev as ClipboardEvent).clipboardData?.files[0];
				break;
			case "drop":
				if (!this.settings.uploadOnDrag && !fmUploadOnDrag) {
					return;
				}
				file = (ev as DragEvent).dataTransfer?.files[0];
		}

		const imageType = /image.*/;
		if (file?.type.match(imageType)) {
			ev.preventDefault();

			// set the placeholder text
			const buf = await file.arrayBuffer();
			const digest = crypto
				.createHash("md5")
				.update(new Uint8Array(buf))
				.digest("hex");
			const contentType = file.type;
			const newFileName =
				digest +
				"." +
				file.name.slice(((file.name.lastIndexOf(".") - 1) >>> 0) + 2);
			const pastePlaceText = `![uploading...](${newFileName})\n`;
			editor.replaceSelection(pastePlaceText);

			// upload the image
			const folder = fmUploadFolder
				? fmUploadFolder
				: this.settings.folder;
			const key = folder ? folder + "/" + newFileName : newFileName;

			if (!localUpload) {
				// Use S3
				this.s3
					.send(
						new PutObjectCommand({
							Bucket: this.settings.bucket,
							Key: key,
							Body: file,
							ContentType: contentType ? contentType : undefined,
						})
					)
					.then((res) => {
						const url = this.settings.imageUrlPath + key;
						const imgMarkdownText = `![image](${url})`;
						this.replaceText(
							editor,
							pastePlaceText,
							imgMarkdownText
						);
						new Notice(
							`Image uploaded to S3 bucket: ${this.settings.bucket}`
						);
					})
					.catch((err) => {
						console.error(err);
						new Notice(
							`Error uploading image to S3 bucket ${this.settings.bucket}: ` +
								err.message
						);
					});
			} else {
				// Use local upload
				const localUploadFolder = fmUploadFolder
					? fmUploadFolder
					: this.settings.localUploadFolder;
				const localUploadPath = localUploadFolder
					? localUploadFolder + "/" + newFileName
					: newFileName;
				await this.app.vault.adapter.mkdir(localUploadFolder);
				this.app.vault.adapter
					.writeBinary(localUploadPath, buf)
					.then(() => {
						const imgMarkdownText = `![image](${localUploadPath})`;
						this.replaceText(
							editor,
							pastePlaceText,
							imgMarkdownText
						);
						new Notice(
							`Image uploaded to ${localUploadFolder} folder`
						);
					})
					.catch((err) => {
						console.log(err);
						new Notice(
							`Error uploading image to ${localUploadFolder} folder: ` +
								err.message
						);
					});
			}
		}
	}

	async onload() {
		await this.loadSettings();

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
			this.app.workspace.on("editor-paste", this.pasteFunction)
		);
		this.registerEvent(
			this.app.workspace.on("editor-drop", this.pasteFunction)
		);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class S3UploaderSettingTab extends PluginSettingTab {
	plugin: S3UploaderPlugin;

	constructor(app: App, plugin: S3UploaderPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Settings for S3 Image Uploader" });

		containerEl.createEl("br");

		const coffeeDiv = containerEl.createDiv("coffee");
		const coffeeLink = coffeeDiv.createEl("a", {
			href: "https://www.buymeacoffee.com/jvsteiner",
		});
		const coffeeImg = coffeeLink.createEl("img", {
			attr: {
				src: "https://cdn.buymeacoffee.com/buttons/v2/default-blue.png",
			},
		});
		coffeeImg.height = 45;
		containerEl.createEl("br");

		new Setting(containerEl)
			.setName("AWS Access Key ID")
			.setDesc("AWS access key ID for a user with S3 access.")
			.addText((text) => {
				wrapTextWithPasswordHide(text);
				text.setPlaceholder("access key")
					.setValue(this.plugin.settings.accessKey)
					.onChange(async (value) => {
						this.plugin.settings.accessKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("AWS Secret Key")
			.setDesc("AWS secret key for that user.")
			.addText((text) => {
				wrapTextWithPasswordHide(text);
				text.setPlaceholder("secret key")
					.setValue(this.plugin.settings.secretKey)
					.onChange(async (value) => {
						this.plugin.settings.secretKey = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Region")
			.setDesc("AWS region of the S3 bucket.")
			.addText((text) =>
				text
					.setPlaceholder("aws region")
					.setValue(this.plugin.settings.region)
					.onChange(async (value) => {
						this.plugin.settings.region = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("S3 Bucket")
			.setDesc("S3 bucket name.")
			.addText((text) =>
				text
					.setPlaceholder("bucket name")
					.setValue(this.plugin.settings.bucket)
					.onChange(async (value) => {
						this.plugin.settings.bucket = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Bucket folder")
			.setDesc("Optional folder in s3 bucket.")
			.addText((text) =>
				text
					.setPlaceholder("folder")
					.setValue(this.plugin.settings.folder)
					.onChange(async (value) => {
						this.plugin.settings.folder = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Upload on drag")
			.setDesc(
				"Upload drag and drop images as well as pasted images. To override this setting on a per-document basis, you can add `uploadOnDrag: true` to YAML frontmatter of the note."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.uploadOnDrag)
					.onChange(async (value) => {
						this.plugin.settings.uploadOnDrag = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Copy to local folder")
			.setDesc(
				"Copy images to local folder instead of s3. To override this setting on a per-document basis, you can add `uploadLocal: true` to YAML frontmatter of the note.  This will copy the images to a folder in your local file system, instead of s3."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.localUpload)
					.onChange(async (value) => {
						this.plugin.settings.localUpload = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Local folder")
			.setDesc(
				'Local folder to save images, instead of s3. To override this setting on a per-document basis, you can add `uploadFolder: "myFolder"` to YAML frontmatter of the note.  This affects only local uploads.'
			)
			.addText((text) =>
				text
					.setPlaceholder("folder")
					.setValue(this.plugin.settings.localUploadFolder)
					.onChange(async (value) => {
						this.plugin.settings.localUploadFolder = value.trim();
						await this.plugin.saveSettings();
					})
			);
	}
}

const wrapTextWithPasswordHide = (text: TextComponent) => {
	const hider = text.inputEl.insertAdjacentElement("beforebegin", createSpan());
	if (!hider) {
		return
	}
	// const hider = text.inputEl.createEl('span');
	setIcon(hider as HTMLElement, 'eye-off');

	hider.addEventListener("click", ()=> {
		const isText = text.inputEl.getAttribute("type") === "text";
		if(isText) {
			setIcon(hider as HTMLElement, 'eye-off');
			text.inputEl.setAttribute("type", "password");
		}else {
			setIcon(hider as HTMLElement, 'eye')
			text.inputEl.setAttribute("type", "text");
		};
		text.inputEl.focus();
	});
	text.inputEl.setAttribute("type", "password");
	return text;
};

