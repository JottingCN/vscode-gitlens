import { TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { GitCommit, GitRevision } from '../git/models';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, Commands, executeCommand, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';

export interface DiffLineWithWorkingCommandArgs {
	commit?: GitCommit;

	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffLineWithWorkingCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.DiffLineWithWorking);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffLineWithWorkingCommandArgs): Promise<any> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		let lhsSha: string;
		let lhsUri: Uri;

		if (args.commit == null || args.commit.isUncommitted) {
			const blameline = args.line;
			if (blameline < 0) return;

			try {
				const blame = await this.container.git.getBlameForLine(gitUri, blameline, editor?.document);
				if (blame == null) {
					void Messages.showFileNotUnderSourceControlWarningMessage('Unable to open compare');

					return;
				}

				args.commit = blame.commit;

				// If the line is uncommitted, use previous commit (or index if the file is staged)
				if (args.commit.isUncommitted) {
					const status = await this.container.git.getStatusForFile(gitUri.repoPath!, gitUri);
					if (status?.indexStatus != null) {
						lhsSha = GitRevision.uncommittedStaged;
						lhsUri = this.container.git.getAbsoluteUri(
							status.originalPath || status.path,
							args.commit.repoPath,
						);
					} else {
						lhsSha = args.commit.file!.previousSha ?? GitRevision.deletedOrMissing;
						lhsUri = args.commit.file!.originalUri ?? args.commit.file!.uri;
					}
				} else {
					lhsSha = args.commit.sha;
					lhsUri = args.commit.file!.uri;
				}
				// editor lines are 0-based
				args.line = blame.line.line - 1;
			} catch (ex) {
				Logger.error(ex, 'DiffLineWithWorkingCommand', `getBlameForLine(${blameline})`);
				void Messages.showGenericErrorMessage('Unable to open compare');

				return;
			}
		} else {
			lhsSha = args.commit.sha;
			lhsUri = args.commit.file?.uri ?? gitUri;
		}

		const workingUri = await args.commit.file?.getWorkingUri();
		if (workingUri == null) {
			void window.showWarningMessage('Unable to open compare. File has been deleted from the working tree');

			return;
		}

		void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
			repoPath: args.commit.repoPath,
			lhs: {
				sha: lhsSha,
				uri: lhsUri,
			},
			rhs: {
				sha: '',
				uri: workingUri,
			},
			line: args.line,
			showOptions: args.showOptions,
		}));
	}
}
