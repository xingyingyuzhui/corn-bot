import { DshHostSupervisor, type HostAdmission } from './dsh-host-supervisor.ts'

const BASIC_ENGINE: HostAdmission = {
  beforeSpawn: async () => {},
  afterAuth: async () => {},
}

/**
 * Basic keyless Host for `setup:runtime`, the profile template build and the
 * basic-engine `smoke:cold` only. Its start is never App readiness: the App
 * and every governed smoke use `createGovernedHost`, and setup must pass that
 * formal admission after installing Claw.
 */
export function createBootstrapHost(home: string): DshHostSupervisor {
  return new DshHostSupervisor(home, { model: null, admission: BASIC_ENGINE })
}
