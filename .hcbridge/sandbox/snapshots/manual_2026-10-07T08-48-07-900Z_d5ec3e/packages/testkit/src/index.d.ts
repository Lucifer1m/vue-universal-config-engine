export interface FixtureRunResult {
    fixture: string;
    nodeCount: number;
    hcpCount: number;
    patchChanged: boolean;
    reparsed: boolean;
}
export declare function runFixture(file: string, change?: import('@hcbridge/hcp').ChangeSet): FixtureRunResult;
