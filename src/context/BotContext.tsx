import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getEngine } from "../lib/engine/engine";
import type { BotEngine } from "../lib/engine/engine";

const EngineContext = createContext<BotEngine>(getEngine());

export function BotProvider({ children }: { children: ReactNode }) {
  return <EngineContext.Provider value={getEngine()}>{children}</EngineContext.Provider>;
}

export function useEngine(): BotEngine {
  return useContext(EngineContext);
}

/** اشتراک در تغییرات موتور — با هر رویداد، رندر تازه اجرا می‌شود */
export function useEngineState<T>(selector: (engine: BotEngine) => T): T {
  const engine = useEngine();
  const [, force] = useState(0);
  useEffect(() => engine.subscribe(() => force((n) => n + 1)), [engine]);
  return selector(engine);
}
