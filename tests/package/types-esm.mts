import { readBlocks, readTree, renderSvg, writeBlocks, type Block, type RenderOptions, type WriteOptions } from "rmscene-ts";

declare const data: Uint8Array;
const blocks: Block[] = readBlocks(data);
const options: WriteOptions = { version: "3.27.3.0" };
const output: Uint8Array = writeBlocks(blocks, options);
const renderOptions: RenderOptions = { viewport: "content", background: "transparent" };
const svg: string = renderSvg(readTree(data), renderOptions).svg;
void blocks;
void output;
void svg;
