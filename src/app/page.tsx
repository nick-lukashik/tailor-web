import { redirect } from 'next/navigation'

/** Nothing of its own: the applications are the start (src/proxy.ts lets in only people with access). */
export default function HomePage() {
    redirect('/applications')
}
