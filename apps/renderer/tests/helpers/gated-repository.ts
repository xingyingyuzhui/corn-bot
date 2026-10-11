import { FixtureWorkspaceRepository } from '../../src/fixtures/fixture-repository.ts'
import type {
  BotProfilePatch,
  CommandResult,
} from '../../src/model/repository.ts'
import type { BotView } from '../../src/model/workspace.ts'

/** Bot profile and model writes wait until the test releases them, in order. */
export class GatedRepository extends FixtureWorkspaceRepository {
  readonly writes: string[] = []
  #release: Array<() => void> = []

  override async updateBotProfile(
    botId: string,
    patch: BotProfilePatch,
    expectedRevision: number,
  ): Promise<CommandResult<number>> {
    await this.#gate(botId)
    return super.updateBotProfile(botId, patch, expectedRevision)
  }

  override async setBotModel(
    botId: string,
    modelId: string | null,
    expectedRevision: number,
  ): Promise<CommandResult<number>> {
    await this.#gate(botId)
    return super.setBotModel(botId, modelId, expectedRevision)
  }

  get waiting(): number {
    return this.#release.length
  }

  release() {
    this.#release.shift()?.()
  }

  #gate(botId: string) {
    this.writes.push(botId)
    return new Promise<void>((resolve) => this.#release.push(resolve))
  }
}

export const botOf = (repository: FixtureWorkspaceRepository, id: string) => {
  const bot: BotView | undefined = repository.getSnapshot().roster.bots[id]
  if (!bot) throw new Error(`fixture Bot ${id} missing`)
  return bot
}

/** Lets already-settled promise callbacks run; never a timed wait. */
export const tick = () => new Promise((resolve) => setImmediate(resolve))
