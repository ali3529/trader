import type { SymbolScan } from "./types";


// --------------------
// AI Provider
// --------------------

export type AiProvider =
  | "ollama"
  | "jev";



// --------------------
// Config
// --------------------

export interface AiConfigView {

  provider: AiProvider;

  ollamaBaseUrl: string;

  ollamaModel: string;

  /** آدرس API ذخیره‌شده (ممکن است خالی باشد = پیش‌فرض SDK) */
  jevBaseUrl: string;

  /** نام مدل ذخیره‌شده */
  jevModel: string;

  jevConfigured: boolean;

  tokenMasked: string | null;

  hasToken: boolean;

}



export interface AiConfigPayload {

  provider: AiProvider;

  ollamaBaseUrl: string;

  ollamaModel: string;

  jevBaseUrl: string;

  jevModel: string;

  /**
   * Only send when replacing stored token
   */
  jevToken: string;

}



// --------------------
// Jev Status
// --------------------

export interface JevStatus {

  provider?: AiProvider;

  reachable: boolean;

  ready: boolean;

  model?: string;

  installedModels?: string[];

  error?: string;

}



// --------------------
// Jev Response Types
// --------------------


export interface JevRisk {

  score: number;

  confidence: number;

  label:
    | "No risk"
    | "Low risk"
    | "Medium risk"
    | "High risk"
    | "Extreme risk";

}



export interface JevAction {

  type: "score";

  score: number;

  confidence: number;

  legend: Record<string,string>;

  probabilities: Record<string,number>;

}



export interface JevAnalysis {

  decision: number;

  risk: JevRisk;

  action: JevAction;

}



// --------------------
// Config API
// --------------------


export async function fetchAiConfig()
: Promise<AiConfigView> {


  const response =
    await fetch(
      "/api/ai/config",
      {
        cache:"no-store"
      }
    );


  if(!response.ok){

    throw new Error(
      `HTTP ${response.status}`
    );

  }


  return response.json();

}




export async function saveAiConfig(
  payload:AiConfigPayload
):Promise<void>{


  const response =
    await fetch(
      "/api/ai/config",
      {

        method:"POST",

        headers:{
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(payload)

      }
    );



  if(!response.ok){


    const body =
      await response
      .json()
      .catch(()=>null);



    throw new Error(
      body?.message ??
      body?.statusMessage ??
      `HTTP ${response.status}`
    );


  }

}




// --------------------
// Jev Status
// --------------------


export async function fetchJevStatus()
:Promise<JevStatus>{


  const response =
    await fetch(
      "/api/ai/status",
      {
        cache:"no-store"
      }
    );



  if(!response.ok){

    throw new Error(
      `HTTP ${response.status}`
    );

  }



  return response.json();

}




// --------------------
// Jev Analyze
// --------------------


export async function analyzeOpportunity(
  scan:SymbolScan
):Promise<JevAnalysis>{



  if(!scan.signal){

    throw new Error(
      "سیگنالی برای تحلیل وجود ندارد"
    );

  }




  const response =
    await fetch(
      "/api/ai/analyze",
      {

        method:"POST",

        headers:{
          "Content-Type":
            "application/json"
        },


        body:
          JSON.stringify({

            symbol:
              scan.symbol,


            price:
              scan.lastPrice,


            changePct24h:
              scan.changePct24h,


            volume24h:
              scan.volume24h,


            signal:
              scan.signal

          })

      }
    );





  if(!response.ok){


    const body =
      await response
      .json()
      .catch(()=>null);



    throw new Error(
      body?.message ??
      body?.statusMessage ??
      `HTTP ${response.status}`
    );


  }




  return response.json();

}