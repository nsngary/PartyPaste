import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { i18n } from "i18next";
import type { PropsWithChildren } from "react";
import { AppProviders } from "../i18n";

const applicationQueryClient = new QueryClient({
  defaultOptions: {
    mutations: { retry: false },
    queries: { retry: 1, staleTime: 2_000 },
  },
});

export interface PartyPasteProvidersProps extends PropsWithChildren {
  i18n?: i18n;
  queryClient?: QueryClient;
}

export function PartyPasteProviders({
  children,
  i18n,
  queryClient = applicationQueryClient,
}: PartyPasteProvidersProps) {
  return (
    <AppProviders i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppProviders>
  );
}
