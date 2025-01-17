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
	FileSystemAdapter,
	RequestUrlParam,
	requestUrl,
} from "obsidian";
import { HttpRequest, HttpResponse } from "@aws-sdk/protocol-http";
import { HttpHandlerOptions } from "@aws-sdk/types";
import { buildQueryString } from "@aws-sdk/querystring-builder";
import { requestTimeout } from "@smithy/fetch-http-handler/dist-es/request-timeout";

import {
	FetchHttpHandler,
	FetchHttpHandlerOptions,
} from "@smithy/fetch-http-handler";

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
	imageUrlPath: string;
	uploadOnDrag: boolean;
	localUpload: boolean;
	localUploadFolder: string;
	useCustomEndpoint: boolean;
	customEndpoint: string;
	forcePathStyle: boolean;
	useCustomImageUrl: boolean;
	customImageUrl: string;
	uploadVideo: boolean;
	uploadAudio: boolean;
	uploadPdf: boolean;
	bypassCors: boolean;
	queryStringValue: string;
	queryStringKey: string;
}

const DEFAULT_SETTINGS: S3UploaderSettings = {
	accessKey: "",
	secretKey: "",
	region: "",
	bucket: "",
	folder: "",
	imageUrlPath: "",
	uploadOnDrag: true,
	localUpload: false,
	localUploadFolder: "",
	useCustomEndpoint: false,
	customEndpoint: "",
	forcePathStyle: false,
	useCustomImageUrl: false,
	customImageUrl: "",
	uploadVideo: false,
	uploadAudio: false,
	uploadPdf: false,
	bypassCors: false,
	queryStringValue: "",
	queryStringKey: "",
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

	async uploadFile(file: File, key: string): Promise<string> {
		const buf = await file.arrayBuffer();
		await this.s3.send(
			new PutObjectCommand({
				Bucket: this.settings.bucket,
				Key: key,
				Body: new Uint8Array(buf),
				ContentType: file.type,
			})
		);
		let urlString = this.settings.imageUrlPath + key;
		if (this.settings.queryStringKey && this.settings.queryStringValue) {
			let urlObject = new URL(urlString);

			// The searchParams property provides methods to manipulate query parameters
			urlObject.searchParams.append(
				this.settings.queryStringKey,
				this.settings.queryStringValue
			);
			urlString = urlObject.toString();
		}
		return urlString;
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

		const fm = this.app.metadataCache.getFileCache(noteFile)?.frontmatter;
		const localUpload = fm?.localUpload ?? this.settings.localUpload;
		const uploadVideo = fm?.uploadVideo ?? this.settings.uploadVideo;
		const uploadAudio = fm?.uploadAudio ?? this.settings.uploadAudio;
		const uploadPdf = fm?.uploadPdf ?? this.settings.uploadPdf;

		new Notice(
			`Event: ${ev.type}\nContents: ${JSON.stringify(
				ev,
				(key, value) => {
					if (value instanceof Node) return "DOM Node";
					return value;
				},
				2
			)}`
		);

		let files: File[] = [];
		switch (ev.type) {
			case "paste":
				files = Array.from(
					(ev as ClipboardEvent).clipboardData?.files || []
				);
				break;
			case "drop":
				if (!this.settings.uploadOnDrag && !(fm && fm.uploadOnDrag)) {
					return;
				}
				files = Array.from((ev as DragEvent).dataTransfer?.files || []);
				break;
			default:
				console.log("Unknown event type");
				console.log(ev);
				return;
		}

		if (files.length > 0) {
			ev.preventDefault();

			const uploads = files.map(async (file) => {
				let thisType = "";
				if (file.type.match(/video.*/) && uploadVideo) {
					thisType = "video";
				} else if (file.type.match(/audio.*/) && uploadAudio) {
					thisType = "audio";
				} else if (file.type.match(/application\/pdf/) && uploadPdf) {
					thisType = "pdf";
				} else if (file.type.match(/image.*/)) {
					thisType = "image";
				} else if (
					file.type.match(/presentation.*/) ||
					file.type.match(/powerpoint.*/)
				) {
					thisType = "ppt";
				}
				if (!thisType) return;

				const buf = await file.arrayBuffer();
				const digest = crypto
					.createHash("md5")
					.update(new Uint8Array(buf))
					.digest("hex");
				const newFileName = `${digest}.${file.name.split(".").pop()}`;
				const placeholder = `![uploading...](${newFileName})\n`;
				editor.replaceSelection(placeholder);

				let folder = "";
				if (localUpload) {
					folder =
						fm?.uploadFolder ?? this.settings.localUploadFolder;
				} else {
					folder = fm?.uploadFolder ?? this.settings.folder;
				}

				const currentDate = new Date();
				folder = folder
					.replace("${year}", currentDate.getFullYear().toString())
					.replace(
						"${month}",
						String(currentDate.getMonth() + 1).padStart(2, "0")
					)
					.replace(
						"${day}",
						String(currentDate.getDate()).padStart(2, "0")
					);
				const key = folder ? `${folder}/${newFileName}` : newFileName;

				try {
					let url;
					if (!localUpload) {
						url = await this.uploadFile(file, key);
					} else {
						await this.app.vault.adapter.writeBinary(
							key,
							new Uint8Array(buf)
						);
						url =
							this.app.vault.adapter instanceof FileSystemAdapter
								? this.app.vault.adapter.getFilePath(key)
								: key;
					}
					const imgMarkdownText = wrapFileDependingOnType(
						url,
						thisType,
						""
					);
					this.replaceText(editor, placeholder, imgMarkdownText);
				} catch (error) {
					console.error(error);
					this.replaceText(
						editor,
						placeholder,
						`Error uploading file: ${error.message}\n`
					);
				}
			});

			await Promise.all(uploads).then(() => {
				new Notice("All files processed.");
			});
		}
	}

	async onload() {
		await this.loadSettings();

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new S3UploaderSettingTab(this.app, this));

		let apiEndpoint = this.settings.useCustomEndpoint
			? this.settings.customEndpoint
			: `https://s3.${this.settings.region}.amazonaws.com/`;
		this.settings.imageUrlPath = this.settings.useCustomImageUrl
			? this.settings.customImageUrl
			: this.settings.forcePathStyle
			? apiEndpoint + this.settings.bucket + "/"
			: apiEndpoint.replace("://", `://${this.settings.bucket}.`);

		if (this.settings.bypassCors) {
			this.s3 = new S3Client({
				region: this.settings.region,
				credentials: {
					// clientConfig: { region: this.settings.region },
					accessKeyId: this.settings.accessKey,
					secretAccessKey: this.settings.secretKey,
				},
				endpoint: apiEndpoint,
				forcePathStyle: this.settings.forcePathStyle,
				requestHandler: new ObsHttpHandler({ keepAlive: false }),
			});
		} else {
			this.s3 = new S3Client({
				region: this.settings.region,
				credentials: {
					// clientConfig: { region: this.settings.region },
					accessKeyId: this.settings.accessKey,
					secretAccessKey: this.settings.secretKey,
				},
				endpoint: apiEndpoint,
				forcePathStyle: this.settings.forcePathStyle,
				requestHandler: new ObsHttpHandler({ keepAlive: false }),
			});
		}

		this.pasteFunction = this.pasteHandler.bind(this);

		this.registerEvent(
			this.app.workspace.on("editor-paste", this.pasteFunction)
		);
		this.registerEvent(
			this.app.workspace.on("editor-drop", this.pasteFunction)
		);
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file, source) => {
				new Notice(
					`File Menu Event:\nSource: ${source}\nFile: ${file?.path}`
				);
			})
		);
		this.registerEvent(
			this.app.workspace.on("editor-change", (editor, changeObj) => {
				// Log the change event to see what's happening
				new Notice(
					`Change Event:\n${JSON.stringify(changeObj, null, 2)}`
				);
			})
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
			.setDesc(
				"Optional folder in s3 bucket. Support the use of ${year}, ${month}, and ${day} variables."
			)
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
			.setName("Upload video files")
			.setDesc(
				"Upload videos. To override this setting on a per-document basis, you can add `uploadVideo: true` to YAML frontmatter of the note."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.uploadVideo)
					.onChange(async (value) => {
						this.plugin.settings.uploadVideo = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Upload audio files")
			.setDesc(
				"Upload audio files. To override this setting on a per-document basis, you can add `uploadAudio: true` to YAML frontmatter of the note."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.uploadAudio)
					.onChange(async (value) => {
						this.plugin.settings.uploadAudio = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Upload pdf files")
			.setDesc(
				"Upload and embed PDF files. To override this setting on a per-document basis, you can add `uploadPdf: true` to YAML frontmatter of the note. Local uploads are not supported for PDF files."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.uploadPdf)
					.onChange(async (value) => {
						this.plugin.settings.uploadPdf = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Copy to local folder")
			.setDesc(
				"Copy images to local folder instead of s3. To override this setting on a per-document basis, you can add `localUpload: true` to YAML frontmatter of the note.  This will copy the images to a folder in your local file system, instead of s3."
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

		new Setting(containerEl)
			.setName("Use custom endpoint")
			.setDesc("Use the custom api endpoint below.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useCustomEndpoint)
					.onChange(async (value) => {
						this.plugin.settings.useCustomEndpoint = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Custom S3 Endpoint")
			.setDesc(
				"Optionally set a custom endpoint for any S3 compatible storage provider."
			)
			.addText((text) =>
				text
					.setPlaceholder("https://s3.myhost.com/")
					.setValue(this.plugin.settings.customEndpoint)
					.onChange(async (value) => {
						value = value.match(/https?:\/\//) // Force to start http(s)://
							? value
							: "https://" + value;
						value = value.replace(/([^\/])$/, "$1/"); // Force to end with slash
						this.plugin.settings.customEndpoint = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("S3 Path Style URLs")
			.setDesc(
				"Advanced option to force using (legacy) path-style s3 URLs (s3.myhost.com/bucket) instead of the modern AWS standard host-style (bucket.s3.myhost.com)."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.forcePathStyle)
					.onChange(async (value) => {
						this.plugin.settings.forcePathStyle = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Use custom image URL")
			.setDesc("Use the custom image URL below.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.useCustomImageUrl)
					.onChange(async (value) => {
						this.plugin.settings.useCustomImageUrl = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Custom Image URL")
			.setDesc(
				"Advanced option to force inserting custom image URLs. This option is helpful if you are using CDN."
			)
			.addText((text) =>
				text
					.setValue(this.plugin.settings.customImageUrl)
					.onChange(async (value) => {
						value = value.match(/https?:\/\//) // Force to start http(s)://
							? value
							: "https://" + value;
						value = value.replace(/([^\/])$/, "$1/"); // Force to end with slash
						this.plugin.settings.customImageUrl = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Bypass local CORS check")
			.setDesc(
				"Bypass local CORS preflight checks - it might work on later versions of Obsidian."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.bypassCors)
					.onChange(async (value) => {
						this.plugin.settings.bypassCors = value;
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName("Query String Key")
			.setDesc("Appended to the end of the URL. Optional")
			.addText((text) =>
				text
					.setPlaceholder("Empty means no query string key")
					.setValue(this.plugin.settings.queryStringKey)
					.onChange(async (value) => {
						this.plugin.settings.queryStringKey = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Query String Value")
			.setDesc("Appended to the end of the URL. Optional")
			.addText((text) =>
				text
					.setPlaceholder("Empty means no query string value")
					.setValue(this.plugin.settings.queryStringValue)
					.onChange(async (value) => {
						this.plugin.settings.queryStringValue = value;
						await this.plugin.saveSettings();
					})
			);
	}
}

const wrapTextWithPasswordHide = (text: TextComponent) => {
	const hider = text.inputEl.insertAdjacentElement(
		"beforebegin",
		createSpan()
	);
	if (!hider) {
		return;
	}
	setIcon(hider as HTMLElement, "eye-off");

	hider.addEventListener("click", () => {
		const isText = text.inputEl.getAttribute("type") === "text";
		if (isText) {
			setIcon(hider as HTMLElement, "eye-off");
			text.inputEl.setAttribute("type", "password");
		} else {
			setIcon(hider as HTMLElement, "eye");
			text.inputEl.setAttribute("type", "text");
		}
		text.inputEl.focus();
	});
	text.inputEl.setAttribute("type", "password");
	return text;
};

const wrapFileDependingOnType = (
	location: string,
	type: string,
	localBase: string
) => {
	const srcPrefix = localBase ? "file://" + localBase + "/" : "";

	if (type === "image") {
		return `![image](${location})`;
	} else if (type === "video") {
		return `<video src="${srcPrefix}${location}" controls />`;
	} else if (type === "audio") {
		return `<audio src="${srcPrefix}${location}" controls />`;
	} else if (type === "pdf") {
		if (localBase) {
			throw new Error("PDFs cannot be embedded in local mode");
		}
		return `<iframe frameborder=0 border=0 width=100% height=800
		src="https://docs.google.com/viewer?embedded=true&url=${location}?raw=true">
		</iframe>`;
	} else if (type === "ppt") {
		return `<iframe
	    src='https://view.officeapps.live.com/op/embed.aspx?src=${location}' 
	    width='100%' height='600px' frameborder='0'>
	  </iframe>`;
	} else {
		throw new Error("Unknown file type");
	}
};

////////////////////////////////////////////////////////////////////////////////
// special handler using Obsidian requestUrl
////////////////////////////////////////////////////////////////////////////////

/**
 * This is close to origin implementation of FetchHttpHandler
 * https://github.com/aws/aws-sdk-js-v3/blob/main/packages/fetch-http-handler/src/fetch-http-handler.ts
 * that is released under Apache 2 License.
 * But this uses Obsidian requestUrl instead.
 */
class ObsHttpHandler extends FetchHttpHandler {
	requestTimeoutInMs: number | undefined;
	constructor(options?: FetchHttpHandlerOptions) {
		super(options);
		this.requestTimeoutInMs =
			options === undefined ? undefined : options.requestTimeout;
	}
	async handle(
		request: HttpRequest,
		{ abortSignal }: HttpHandlerOptions = {}
	): Promise<{ response: HttpResponse }> {
		if (abortSignal?.aborted) {
			const abortError = new Error("Request aborted");
			abortError.name = "AbortError";
			return Promise.reject(abortError);
		}

		let path = request.path;
		if (request.query) {
			const queryString = buildQueryString(request.query);
			if (queryString) {
				path += `?${queryString}`;
			}
		}

		const { port, method } = request;
		const url = `${request.protocol}//${request.hostname}${
			port ? `:${port}` : ""
		}${path}`;
		const body =
			method === "GET" || method === "HEAD" ? undefined : request.body;

		const transformedHeaders: Record<string, string> = {};
		for (const key of Object.keys(request.headers)) {
			const keyLower = key.toLowerCase();
			if (keyLower === "host" || keyLower === "content-length") {
				continue;
			}
			transformedHeaders[keyLower] = request.headers[key];
		}

		let contentType: string | undefined = undefined;
		if (transformedHeaders["content-type"] !== undefined) {
			contentType = transformedHeaders["content-type"];
		}

		let transformedBody: any = body;
		if (ArrayBuffer.isView(body)) {
			transformedBody = bufferToArrayBuffer(body);
		}

		const param: RequestUrlParam = {
			body: transformedBody,
			headers: transformedHeaders,
			method: method,
			url: url,
			contentType: contentType,
		};

		const raceOfPromises = [
			requestUrl(param).then((rsp) => {
				const headers = rsp.headers;
				const headersLower: Record<string, string> = {};
				for (const key of Object.keys(headers)) {
					headersLower[key.toLowerCase()] = headers[key];
				}
				const stream = new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(new Uint8Array(rsp.arrayBuffer));
						controller.close();
					},
				});
				return {
					response: new HttpResponse({
						headers: headersLower,
						statusCode: rsp.status,
						body: stream,
					}),
				};
			}),
			requestTimeout(this.requestTimeoutInMs),
		];

		if (abortSignal) {
			raceOfPromises.push(
				new Promise<never>((resolve, reject) => {
					abortSignal.onabort = () => {
						const abortError = new Error("Request aborted");
						abortError.name = "AbortError";
						reject(abortError);
					};
				})
			);
		}
		return Promise.race(raceOfPromises);
	}
}

const bufferToArrayBuffer = (b: Buffer | Uint8Array | ArrayBufferView) => {
	return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
