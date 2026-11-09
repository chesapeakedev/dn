// Copyright 2026 Chesapeake Computing
// SPDX-License-Identifier: Apache-2.0

/**
 * Unified user task list at ~/.dn/todo.md (kickstart queue + native Void tasks).
 */

export {
  applyTaskSyncOp,
  deleteNativeTask,
  deleteTask,
  getNativeTask,
  getTask,
  getTaskDocumentPath,
  getTaskPath,
  listNativeTasks,
  listTasks,
  upsertNativeTask,
  upsertTask,
} from "./native.ts";

export { closeoutDenoise, closeoutGitHub, closeoutTodo } from "./closeout.ts";

export type {
  CloseoutDenoiseResult,
  CloseoutGitHubResult,
  CloseoutOptions,
} from "./closeout.ts";

export {
  addToTaskList,
  addToTodoList,
  completeGitHubIssueForRef,
  firstUnchecked,
  formatTaskQueuePrompt,
  formatTodoQueuePrompt,
  itemRefMatchesTarget,
  markDone,
  markQueueItemDoneIfPresent,
  promptAndAddToTaskList,
  promptAndAddToTodoList,
  readFullTaskListFile,
  readTaskList,
  readTodoList,
  resolveGitHubRef,
  writeFullTaskListFile,
  writeTaskList,
  writeTodoList,
} from "./queue.ts";

export type { TaskList, TaskListItem, TodoItem, TodoList } from "./queue.ts";

export {
  getDnHomeDir,
  getLegacyTasksDir,
  getLegacyTasksMigratedDir,
  getTaskListLockPath,
  getTaskListPath,
  getTodoPath,
} from "./paths.ts";

export {
  NATIVE_TASK_REF_PREFIX,
  nativeTaskIdFromRef,
  nativeTaskRef,
  parseTaskListFile,
  parseTodoFile,
  serializeTaskListFile,
  serializeTodoList,
} from "./listFile.ts";

export { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.ts";

export { withTaskListLock } from "./lock.ts";

export { migrateLegacyJsonTaskDirIfNeeded } from "./migrate.ts";
