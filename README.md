# Obsidian Sample Plugin

This is a plugin for Obsidian (https://obsidian.md). It was generated based on the [standard plugin template](https://github.com/obsidianmd/obsidian-sample-plugin).

This project implements an image uploader, similar to others offerred by the community, with one important difference: you can provide your own s3 based storage, instead of relying on a third party service, such as `imgur`.

Note: this plugin is still in development, and there maybe some bugs. Please report any issues you find.

It was inspired by the following plugins:

-   [Obsidian Image Uploader](https://github.com/Creling/obsidian-image-uploader)
-   [Remotely Save](https://github.com/remotely-save/remotely-save)
-   [Obsidian Imgur Plugin](https://github.com/gavvvr/obsidian-imgur-plugin)

## Usage

You have to set up your own s3 bucket, and provide the following information to the plugin:

-   `bucket`: the name of your bucket
-   `region`: the region of your bucket
-   `accessKeyId`: the access key id for an s3 user with write access to your bucket
-   `secretAccessKey`: the secret access key for the s3 user
-   `folder`: the folder in your bucket where you want to store the images (optional)

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

You also need to set up a CORS policy:

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
