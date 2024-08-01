import { App } from "cdktf";
import { BackendApp } from "./backend";
import { FrontendApp } from "./frontend";

const app = new App();
new FrontendApp(app, "frontend");
new BackendApp(app, "backend");
app.synth();