import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { vcsCommandConcurrency, vcsCommandScheduler } from "./vcsCommandScheduler.ts";

export function createGitEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    pullRequestResolution: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:resolve-pull-request",
      tag: WS_METHODS.gitResolvePullRequest,
    }),
    listRemotes: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:list-remotes",
      tag: WS_METHODS.vcsListRemotes,
    }),
    listPullRequests: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:git:list-pull-requests",
      tag: WS_METHODS.gitListPullRequests,
      // Keep PR statuses (open/draft/merged/closed) current: poll while the
      // picker is open and refetch promptly when reopened. Polling only runs
      // while the atom has subscribers (i.e. the dialog is open).
      staleTimeMs: 10_000,
      refreshIntervalMs: 15_000,
    }),
    preparePullRequestThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:git:prepare-pull-request-thread",
      tag: WS_METHODS.gitPreparePullRequestThread,
      scheduler: vcsCommandScheduler,
      concurrency: vcsCommandConcurrency,
    }),
  };
}
