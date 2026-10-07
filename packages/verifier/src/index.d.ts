export interface VerifyResult {
    reparse: {
        ok: boolean;
        diagnostics: string[];
    };
    typecheck: {
        attempted: boolean;
        ok: boolean;
        output?: string;
    };
    build: {
        attempted: boolean;
        ok: boolean;
        output?: string;
    };
    projectFiles?: {
        file: string;
        ok: boolean;
        diagnostics: string[];
    }[];
}
export declare function verifyFile(file: string, text: string): VerifyResult;
export declare function verifyProject(projectDir: string, options?: {
    runTypecheck?: boolean;
    runBuild?: boolean;
}): VerifyResult;
