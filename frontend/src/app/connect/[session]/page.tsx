import PhoneConnect from "./phone-connect";

type Props = {
  params: Promise<{ session: string }>;
  searchParams: Promise<{ token?: string }>;
};

export default async function ConnectPage({ params, searchParams }: Props) {
  const [{ session }, { token }] = await Promise.all([params, searchParams]);
  return <PhoneConnect sessionId={session.toUpperCase()} initialToken={token ?? ""} />;
}
