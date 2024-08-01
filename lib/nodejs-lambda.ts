import { AssetType, Resource, TerraformAsset } from "cdktf";
import { Construct } from "constructs";
import { buildSync } from "esbuild";
import * as path from "path";

export interface NodejsFunctionProps {
    handler: string;
    path: string;
    entrypoint: string;
}

const bundle = (workingDirectory: string, entrypoint: string) => {
    buildSync({
        entryPoints: [entrypoint],
        platform: "node",
        target: "es2018",
        bundle: true,
        format: "cjs",
        sourcemap: "external",
        outdir: "dist",
        absWorkingDir: workingDirectory,
    });

    return path.join(workingDirectory, "dist");
};

export class NodejsFunction extends Resource {
    public readonly handler: string;
    public readonly asset: TerraformAsset;

    constructor(scope: Construct, id: string, props: NodejsFunctionProps) {
        super(scope, id);

        this.handler = props.handler;

        const workingDirectory = path.resolve(props.path);
        const distPath = bundle(workingDirectory, props.entrypoint);

        this.asset = new TerraformAsset(this, "lambda-asset", {
            path: distPath,
            type: AssetType.ARCHIVE, // if left empty it infers directory and file
        });
    }
}
