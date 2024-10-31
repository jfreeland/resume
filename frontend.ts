import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { S3Bucket } from "@cdktf/provider-aws/lib/s3-bucket";
import { S3BucketPolicy } from "@cdktf/provider-aws/lib/s3-bucket-policy";
import { S3BucketPublicAccessBlock } from "@cdktf/provider-aws/lib/s3-bucket-public-access-block";
import { S3BucketWebsiteConfiguration } from "@cdktf/provider-aws/lib/s3-bucket-website-configuration";
import { S3Object } from "@cdktf/provider-aws/lib/s3-object";
import { DataCloudflareAccounts } from "@cdktf/provider-cloudflare/lib/data-cloudflare-accounts";
import { DataCloudflareZone } from "@cdktf/provider-cloudflare/lib/data-cloudflare-zone";
import { CloudflareProvider } from "@cdktf/provider-cloudflare/lib/provider";
import { Record } from "@cdktf/provider-cloudflare/lib/record";
import { AssetType, S3Backend, TerraformAsset, TerraformStack } from "cdktf";
import { Construct } from "constructs";

export class FrontendApp extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    require("dotenv").config();

    new AwsProvider(this, "aws", {
      region: "us-east-1",
    });

    const siteName = "joey.free.land";
    const siteDomain = "free.land";
    const stackName = "frontend";

    new S3Backend(this, {
      bucket: process.env.S3_BACKEND_BUCKET || "",
      // TODO: https://medium.com/@stevosjt88/managing-cdktf-terraform-state-with-aws-s3-and-dynamodb-137f82116a1a
      // dynamodbTable: "",
      key: siteName,
      region: "us-west-2",
      encrypt: true,
    });

    const bucket = new S3Bucket(this, "_bucket", {
      bucket: siteName,
      forceDestroy: true,
    });

    const bucketWebsite = new S3BucketWebsiteConfiguration(
      this,
      stackName + "bucketWebsiteConfig",
      {
        bucket: bucket.id,
        indexDocument: {
          suffix: "index.html",
        },
        errorDocument: {
          key: "error.html",
        },
      },
    );

    const assets = new TerraformAsset(this, stackName + "_assets", {
      path: "public",
      type: AssetType.DIRECTORY,
    });

    // There must be a better way to add S3Objects but I'm rushed.
    for (var filename of ["index", "error"]) {
      new S3Object(this, filename + "HTML", {
        bucket: bucket.id,
        key: filename + ".html",
        source: assets.path + "/" + filename + ".html",
        contentType: "text/html",
      });
    }

    new S3BucketPublicAccessBlock(this, stackName + "_s3BlockPublicAccess", {
      bucket: bucket.id,
      blockPublicAcls: false,
      blockPublicPolicy: false,
      ignorePublicAcls: false,
      restrictPublicBuckets: false,
    });

    // https://www.cloudflare.com/ips/
    new S3BucketPolicy(this, stackName + "_bucketPolicy", {
      bucket: bucket.id,
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "CloudflarePublicReadObject",
            Effect: "Allow",
            Principal: "*",
            Action: "s3:GetObject",
            Resource: [bucket.arn, bucket.arn + "/*"],
            Condition: {
              IpAddress: {
                "aws:SourceIp": [
                  "173.245.48.0/20",
                  "103.21.244.0/22",
                  "103.22.200.0/22",
                  "103.31.4.0/22",
                  "141.101.64.0/18",
                  "108.162.192.0/18",
                  "190.93.240.0/20",
                  "188.114.96.0/20",
                  "197.234.240.0/22",
                  "198.41.128.0/17",
                  "162.158.0.0/15",
                  "104.16.0.0/13",
                  "104.24.0.0/14",
                  "172.64.0.0/13",
                  "131.0.72.0/22",
                  "2400:cb00::/32",
                  "2606:4700::/32",
                  "2803:f800::/32",
                  "2405:b500::/32",
                  "2405:8100::/32",
                  "2a06:98c0::/29",
                  "2c0f:f248::/32",
                ],
              },
            },
          },
        ],
      }),
    });

    new CloudflareProvider(this, "cloudflare", {
      apiToken: process.env.CLOUDFLARE_API_KEY,
    });

    const cfAccount = new DataCloudflareAccounts(
      this,
      stackName + "_cfAccount",
      {},
    );
    const cfZone = new DataCloudflareZone(this, stackName + "_cfZone", {
      accountId: cfAccount.accounts.get(0).id,
      name: siteDomain,
    });

    new Record(this, stackName + "_cdnRecord", {
      zoneId: cfZone.id,
      name: siteName,
      type: "CNAME",
      value: bucketWebsite.websiteEndpoint,
      ttl: 1,
      proxied: true,
    });
  }
}
