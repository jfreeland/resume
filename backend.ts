import { AcmCertificate } from "@cdktf/provider-aws/lib/acm-certificate";
import { AcmCertificateValidation } from "@cdktf/provider-aws/lib/acm-certificate-validation";
import { Apigatewayv2Api } from "@cdktf/provider-aws/lib/apigatewayv2-api";
import { Apigatewayv2ApiMapping } from "@cdktf/provider-aws/lib/apigatewayv2-api-mapping";
import { Apigatewayv2DomainName } from "@cdktf/provider-aws/lib/apigatewayv2-domain-name";
import { Apigatewayv2Integration } from "@cdktf/provider-aws/lib/apigatewayv2-integration";
import { Apigatewayv2Route } from "@cdktf/provider-aws/lib/apigatewayv2-route";
import { CloudwatchLogGroup } from "@cdktf/provider-aws/lib/cloudwatch-log-group";
import { DynamodbTable } from "@cdktf/provider-aws/lib/dynamodb-table";
import { IamRole } from "@cdktf/provider-aws/lib/iam-role";
import { IamRolePolicyAttachment } from "@cdktf/provider-aws/lib/iam-role-policy-attachment";
import { LambdaFunction } from "@cdktf/provider-aws/lib/lambda-function";
import { LambdaPermission } from "@cdktf/provider-aws/lib/lambda-permission";
import { AwsProvider } from "@cdktf/provider-aws/lib/provider";
import { S3Bucket } from "@cdktf/provider-aws/lib/s3-bucket";
import { S3BucketVersioningA } from "@cdktf/provider-aws/lib/s3-bucket-versioning";
import { S3Object } from "@cdktf/provider-aws/lib/s3-object";
import { DataCloudflareAccounts } from "@cdktf/provider-cloudflare/lib/data-cloudflare-accounts";
import { DataCloudflareZone } from "@cdktf/provider-cloudflare/lib/data-cloudflare-zone";
import { PageRule } from "@cdktf/provider-cloudflare/lib/page-rule";
import { CloudflareProvider } from "@cdktf/provider-cloudflare/lib/provider";
import { Record } from "@cdktf/provider-cloudflare/lib/record";
import { S3Backend, TerraformStack } from "cdktf";
import { Construct } from "constructs";
import * as path from "path";
import { NodejsFunction } from "./lib/nodejs-lambda";

const lambdaRolePolicy = {
    "Version": "2012-10-17",
    "Statement": [
        {
            "Action": "sts:AssumeRole",
            "Principal": {
                "Service": "lambda.amazonaws.com",
            },
            "Effect": "Allow",
            "Sid": "",
        },
    ],
};

// https://github.com/hashicorp/learn-cdktf-assets-stacks-lambda
// https://github.com/cdktf/cdktf-integration-serverless-example/blob/d91ff61331abae4c699c5d3e6451969522f14a4a/posts/api/index.ts#L13
export class BackendApp extends TerraformStack {
    constructor(scope: Construct, name: string) {
        super(scope, name);

        new AwsProvider(this, "Aws", {
            region: "us-east-1",
        });

        const siteName = "free.land";
        const stackName = "visits";

        new S3Backend(this, {
        bucket: process.env.S3_BACKEND_BUCKET || "",
        // TODO: https://medium.com/@stevosjt88/managing-cdktf-terraform-state-with-aws-s3-and-dynamodb-137f82116a1a
        // dynamodbTable: "",
        key: "api." + siteName,
        region: "us-west-2",
        encrypt: true,
        });


        const visitsLambda = new NodejsFunction(this, stackName + "_lambda_asset", {
            handler: "index.handler",
            path: path.join(__dirname, "functions", stackName),
            entrypoint: "index.js",
        });

        const bucket = new S3Bucket(this, "bucket", {
            bucketPrefix: stackName,
        });

        new S3BucketVersioningA(this, "bucket_versioning", {
            bucket: bucket.id,
            versioningConfiguration: {
                status: "Disabled",
            },
        });

        const uniqueId = Math.floor(Math.random() * 1E16);
        const lambdaArchive = new S3Object(this, stackName + "_lambda_archive", {
            bucket: bucket.id,
            key: visitsLambda.asset.fileName + "-" + uniqueId,
            source: visitsLambda.asset.path,
        });

        const lambdaRole = new IamRole(this, stackName + "lambdaRole", {
            name: stackName,
            assumeRolePolicy: JSON.stringify(lambdaRolePolicy),
        });

        new IamRolePolicyAttachment(this, stackName + "_lambdaDynamoAccess", {
            policyArn: "arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess",
            role: lambdaRole.name,
        });

        new IamRolePolicyAttachment(this, stackName + "_lambdaBasicExecution", {
            policyArn:
                "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
            role: lambdaRole.name,
        });

        const logGroup = new CloudwatchLogGroup(
            this,
            stackName + "_lambda_cwlogs",
            {
                name: "/aws/lambda/" + stackName,
                retentionInDays: 1,
            },
        );

        const lambdaFunction = new LambdaFunction(this, stackName + "_lambda", {
            functionName: stackName,
            s3Bucket: bucket.id,
            s3Key: lambdaArchive.key,
            role: lambdaRole.arn,
            handler: "index.handler",
            runtime: "nodejs20.x",
            loggingConfig: {
                applicationLogLevel: "INFO",
                logFormat: "JSON",
                systemLogLevel: "INFO",
                logGroup: logGroup.name,
            },
        });

        new DynamodbTable(this, stackName + "_dynamodb", {
            name: stackName,
            attribute: [
                {
                    name: "id",
                    type: "S",
                },
            ],
            hashKey: "id",
            billingMode: "PAY_PER_REQUEST",
        });

        // TODO: should be v2
        const api = new Apigatewayv2Api(this, stackName + "_apigw", {
            name: stackName,
            protocolType: "HTTP",
            target: lambdaFunction.arn,
            corsConfiguration: {
                allowHeaders: ["*"],
                allowMethods: ["GET", "HEAD", "OPTIONS", "POST"],
                allowOrigins: ["*"],
                exposeHeaders: ["*"],
                maxAge: 3600,
            },
        });

        const int = new Apigatewayv2Integration(
            this,
            stackName + "_apigwv2_integration_post",
            {
                apiId: api.id,
                integrationType: "AWS_PROXY",
                connectionType: "INTERNET",
                integrationMethod: "POST",
                integrationUri: lambdaFunction.invokeArn,
            },
        );

        // TODO: stage: v0, v1, prod, ...
        // new Apigatewayv2Stage(this, stackName + "_aipgwv2_stage_default", {});

        new Apigatewayv2Route(this, stackName + "_apigwv2_route", {
            apiId: api.id,
            routeKey: "ANY /" + stackName,
            target: "integrations/" + int.id,
        });

        new LambdaPermission(this, "permission", {
            statementId: "AllowAPIGateway",
            action: "lambda:InvokeFunction",
            functionName: lambdaFunction.functionName,
            principal: "apigateway.amazonaws.com",
            sourceArn: api.executionArn + "/*/*",
        });

        require("dotenv").config();
        new CloudflareProvider(this, "cloudflare", {
            apiToken: process.env.CLOUDFLARE_API_KEY,
        });

        const cfAccount = new DataCloudflareAccounts(this, stackName + "_cfAccount", {});
        const cfZone = new DataCloudflareZone(this, "cfZone", {
            accountId: cfAccount.accounts.get(0).id,
            name: siteName,
        });

        const acm = new AcmCertificate(this, stackName + "_cert", {
            domainName: "api." + siteName,
            validationMethod: "DNS",
        });

        const acmValidationOptions = acm.domainValidationOptions.get(0);

        new Record(this, stackName + "_acm_validation", {
            zoneId: cfZone.id,
            name: acmValidationOptions.resourceRecordName,
            type: acmValidationOptions.resourceRecordType,
            value: acmValidationOptions.resourceRecordValue,
            ttl: 60,
            proxied: false,
        });

        new AcmCertificateValidation(this, stackName + "_acm_cert_validation", {
            certificateArn: acm.arn,
            validationRecordFqdns: [acmValidationOptions.resourceRecordName],
        });

        new Apigatewayv2DomainName(this, stackName + "_apigw_domain", {
            domainName: "api." + siteName,
            domainNameConfiguration: {
                certificateArn: acm.arn,
                endpointType: "REGIONAL",
                securityPolicy: "TLS_1_2",
            }
        });

        new Apigatewayv2ApiMapping(this, stackName + "_apigw_mapping", {
            apiId: api.id,
            stage: "$default",
            domainName: "api." + siteName,
        });

        //console.log("api.apiEndpoint: " + AwsCdkToken.asString(api.apiEndpoint));
        //console.log("api.apiEndpoint: " + api.apiEndpoint);
        //var apiEndpoint = api.getAnyMapAttribute("api_endpoint");
        //console.log("api endpoint: " + apiEndpoint);
        //var apiEndpointClean = apiEndpoint.replace("https://", "");
        //console.log("api endpoint clean: " + apiEndpointClean);

        new Record(this, stackName + "cdnRecord", {
            zoneId: cfZone.id,
            name: "api",
            type: "CNAME",
            // NOTE: There must be a better way.
            // value: api.apiEndpoint.replace("https://", ""),
            // Did not work.
            value:
                `\${replace(aws_apigatewayv2_api.visits_apigw.api_endpoint, "https://", "")}`,
            ttl: 1,
            proxied: true,
        });

        new PageRule(this, stackName + "pageRule", {
            zoneId: cfZone.id,
            status: "active", 
            target: "api." + siteName + "/*",
            priority: 1,
            actions: {
                ssl: "full",
            }
        });
    }
}