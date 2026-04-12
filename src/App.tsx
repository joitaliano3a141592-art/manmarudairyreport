import { PowerProvider } from "./providers/power-provider"
import { ThemeProvider } from "@/providers/theme-provider"
import { SonnerProvider } from "@/providers/sonner-provider"
import { QueryProvider } from "./providers/query-provider"
import { MsalAuthProvider } from "@/providers/msal-provider"
import { RouterProvider } from "react-router-dom"
import { router } from "@/router"

export default function App() {
  return (
    <PowerProvider>
      <MsalAuthProvider>
        <ThemeProvider>
          <SonnerProvider>
            <QueryProvider>
              <RouterProvider router={router} />
            </QueryProvider>
          </SonnerProvider>
        </ThemeProvider>
      </MsalAuthProvider>
    </PowerProvider>
  )
}