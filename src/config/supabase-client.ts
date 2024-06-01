/**
 * @fileoverview Supabase client wrapper.
 */

import {
  createClient,
  SupabaseClient,
  SupabaseClientOptions,
} from "@supabase/supabase-js";
import {
  FunctionInvokeOptions,
  FunctionsResponse,
} from "@supabase/functions-js";
// import { sendMessage } from "./runtime-message";
// import { customFetch } from "./fetch-utils";
// import { isBrowser } from "./helpers";
// import logger from "./logging";

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
export const supabasePublicAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const DEFAULT_HEADERS: Record<string, string> = {
  "X-Client-Info": "supabase-js-web/2.39.1",
};

export class WrappedSupabaseClient {
  supabase: SupabaseClient<any, "public", any>;

  constructor() {
    this.supabase = getSupabase();
  }

  // async refreshToken() {
  //   const { data, error } = await this.supabase.functions.invoke(
  //     "auth-handler",
  //     {
  //       method: "POST",
  //       body: {
  //         op: "refresh-token",
  //       },
  //     }
  //   );
  //   if (error) {
  //     logger.log("refreshToken error:", error);
  //   } else {
  //     logger.log("refreshToken resp:", data);
  //     if (data.access_token) {
  //       await storeAccessToken(appState.value.user?.provider_uid ?? null, data.access_token);
  //     }
  //   }
  // }
}

/**
 * Supabase client wrapper singleton.
 */
export const supabaseWrapper = new WrappedSupabaseClient();

export function getSupabase(access_token?: string) {
  const options: SupabaseClientOptions<"public"> = {};
  options.auth = {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  };
  options.global = {
    // fetch: customFetch,
    headers: {
      ...DEFAULT_HEADERS,
      apikey: supabasePublicAnonKey,
    },
  };
  if (access_token) {
    options.global.headers = {
      Authorization: `Bearer ${access_token}`,
    };
  }
  console.log("creating new supabase client, options:", options);
  return createClient(supabaseUrl, supabasePublicAnonKey, options);
}

// Refresh token in background.
// export async function refreshToken<T extends Function>(
//   supabaseWrapper: WrappedSupabaseClient,
//   sendResponse?: T,
// ) {
//   supabaseWrapper.refreshToken();

//   if (sendResponse) {
//     sendResponse({ is_ok: true, data: "ok" });
//   }
// }

// export async function clearJwt(providerUid: string | null) {
//   if (chrome.runtime?.id) {
//     await clearAccessToken(providerUid);
//     logger.log("jwt cleared");
//   } else {
//     const resp = await sendMessage({
//       type: "clear-access-token",
//       data: { provider_uid: providerUid },
//     });
//     if (!resp.is_ok) {
//       logger.log("jwt clear failed:", resp.error);
//     }
//   }
// }

export async function getUserInfo(supabaseWrapper?: WrappedSupabaseClient) {
  const supabase = supabaseWrapper ? supabaseWrapper.supabase : getSupabase();
  const { data, error } = await supabase
    .from("users")
    .select(
      "user_id,username,name,provider,provider_uid,subscription_tier,current_period_end,user_profile_build_status",
    )
    .single();
  if (error) {
    console.log("getUserInfo error:", error);
  } else {
    console.log("getUserInfo resp:", data);
    return data;
  }
}

export async function debugTokenRequest(
  supabaseWrapper: WrappedSupabaseClient,
) {
  const { data, error } = await supabaseWrapper.supabase.functions.invoke(
    "auth-handler",
    {
      method: "POST",
      body: {
        op: "debug-token",
      },
    },
  );
  if (error) {
    console.log("debugTokenRequest error:", error);
  } else {
    console.log("debugTokenRequest resp:", data);
  }
}

// !!! Only available in background. !!!
export async function invokeFunctionInBackground<T = any>(
  supabaseWrapper: WrappedSupabaseClient,
  functionName: string,
  options: FunctionInvokeOptions = {},
): Promise<FunctionsResponse<T>> {
  return await supabaseWrapper.supabase.functions.invoke(functionName, options);
}

// Available in content script and background.
// `supabaseWrapper` should be passed in background.
// export async function invokeFunction<T = any>(
//   functionName: string,
//   options: FunctionInvokeOptions = {},
//   supabaseWrapper?: WrappedSupabaseClient,
// ): Promise<FunctionsResponse<T>> {
//   if (!isBrowser() && supabaseWrapper) {
//     // 在扩展上下文 service-worker 中执行的代码
//     return await invokeFunctionInBackground(
//       supabaseWrapper,
//       functionName,
//       options,
//     );
//   } else {
//     // 在 content script 上下文中执行的代码
//     const resp = await sendMessage({
//       type: "invoke-supabase-function",
//       data: { function_name: functionName, options },
//     });
//     if (resp.is_ok) {
//       logger.log("invokeFunction resp:", resp.data);
//       return resp.data;
//     } else {
//       logger.log("invokeFunction error:", resp.error);
//       throw new Error(resp.error);
//     }
//   }
// }
