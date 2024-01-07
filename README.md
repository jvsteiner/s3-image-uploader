# S3 Image Uploader

This is a plugin for [Obsidian](https://obsidian.md). It was generated based on the [standard plugin template](https://github.com/obsidianmd/obsidian-sample-plugin).

This project implements an image uploader, similar to others offered by the community, with one important difference: you can provide your own s3 based storage, instead of relying on a third party service, such as `imgur`.

This plugin is supported by advertisements.

Note: this plugin is still in development, and there may be some bugs. Please report any issues you find.

It was inspired by the awesome Markdown editor, Typora, and the following Obsidian plugins:

-   [Obsidian Image Uploader](https://github.com/Creling/obsidian-image-uploader)
-   [Remotely Save](https://github.com/remotely-save/remotely-save)
-   [Obsidian Imgur Plugin](https://github.com/gavvvr/obsidian-imgur-plugin)

## Usage

You have to set up your own s3 bucket, and provide the following information to the plugin:

-   `accessKeyId`: the access key ID for an s3 user with write access to your bucket
-   `secretAccessKey`: the secret access key for the s3 user
-   `region`: the region of your bucket
-   `bucket`: the name of your bucket (must already exist)
-   `folder`: the folder in your bucket where you want to store the images (optional, and will be created on the fly if it does not exist.)

If you want others to be able to view the images, you need to make your bucket world readable. You can do this by adding the following policy to your bucket:

```json
{
	"Version": "2008-10-17",
	"Statement": [
		{
			"Sid": "PublicReadGetObject",
			"Effect": "Allow",
			"Principal": "*",
			"Action": "s3:GetObject",
			"Resource": "arn:aws:s3:::<your-bucket>/*"
		}
	]
}
```

You also need to set up a CORS policy for the bucket:

```json
[
	{
		"AllowedHeaders": ["*"],
		"AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
		"AllowedOrigins": ["*"],
		"ExposeHeaders": []
	}
]
```

You also need to set up a user with write access to your bucket. You can do this by creating a new user in the IAM console, and attaching the `AmazonS3FullAccess` policy to it. More granular access control policies are possible, but this is the simplest way to get started.

When you paste an image from the clipboard into the Obsidian note, the plugin will upload the image to your bucket, and insert a link to the image in your note. The link will be of the form `https://<your-bucket>.s3.<your-region>.amazonaws.com/<your-optional-folder>/<image-name>`. If you have made your bucket world readable, you can share the link with others, and they will be able to view the image.

If you select the "Upload on drag" option in the plugin settings, the plugin will also upload images that you drag into the note - as well as video, audio files and pdfs. This is useful if you want to upload these media from your file system.

If you do not want this behavior in all notes, you can customize it on a per note basis.

1. You can add an `uploadOnDrag` YAML frontmatter tag to the note, as seen below.
2. You can also set the `localUpload` option to `true`, which will copy the images to a folder in your local file system, instead of uploading them to the cloud, overriding the global setting.
3. You can also set note specific folder where the images will be uploaded to, by adding the `localUploadFolder` option to the YAML frontmatter. This overrides the global setting.

These settings override the global settings. The `uploadOnDrag` tag affects both S3 and local uploads. The other two options only affect local uploads.

```
---
uploadOnDrag: true
localUpload: true
localUploadFolder: "my-folder"
---
```

## Development

PR's are welcome, features that I would like to add include:

-   [ ] Add support for other cloud storage providers, such as Google Drive, Dropbox, etc.
-   [x] Add support for copying images to a configurable folder in the local file system, instead of uploading them to the cloud.
-   [ ] Add support for dynamically moving images between the options above, through hotkeys.
-   [ ] Add support for automatically creating buckets if they do not exist.
-   [x] Add support for s3 compatible storage
-   [x] Add support for video, audio, and pdf upload and embedding.

### Releasing new releases

Update your manifest.json with your new version number, such as 1.0.1, and the minimum Obsidian version required for your latest release.

Update your versions.json file with "new-plugin-version": "minimum-obsidian-version" so older versions of Obsidian can download an older version of your plugin that's compatible.

Create new GitHub release using your new version number as the "Tag version". Use the exact version number, don't include a prefix v. See here for an example: https://github.com/obsidianmd/obsidian-sample-plugin/releases

Upload the files manifest.json, main.js, styles.css as binary attachments. Note: The manifest.json file must be in two places, first the root path of your repository and also in the release.

Publish the release.

> You can simplify the version bump process by running npm version patch, npm version minor or npm version major after updating minAppVersion manually in manifest.json. The command will bump version in manifest.json and package.json, and add the entry for the new version to versions.json
