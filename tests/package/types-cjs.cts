import rmScene = require("rmscene-ts");

declare const data: Uint8Array;
const blocks: rmScene.Block[] = rmScene.readBlocks(data);
const options: rmScene.WriteOptions = { version: "3.27.3.0" };
const output: Uint8Array = rmScene.writeBlocks(blocks, options);
const renderOptions: rmScene.RenderOptions = { viewport: "content", background: "transparent" };
const svg: string = rmScene.renderSvg(rmScene.readTree(data), renderOptions).svg;
void blocks;
void output;
void svg;
