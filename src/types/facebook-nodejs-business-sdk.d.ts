// The Meta SDK ships without TypeScript types. We intentionally treat it as
// `any` at this boundary: client.ts normalizes raw SDK responses into the
// types in src/lib/meta/types.ts, so untyped SDK shapes never leak elsewhere.
//
// Only the surface client.ts actually touches is declared here. If you need
// more of the SDK, add it — keeping it explicit makes the boundary visible.
declare module "facebook-nodejs-business-sdk" {
  export const FacebookAdsApi: {
    init(accessToken: string): { setDebug(debug: boolean): void };
  };

  export class AdAccount {
    constructor(id: string);
    getCampaigns(
      fields: string[],
      params?: Record<string, unknown>,
    ): Promise<Campaign[]>;
  }

  export class Campaign {
    [key: string]: any;
  }
}
