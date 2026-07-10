import Head from "next/head";

export default function Home() {
	return (
		<div className="home">
			<Head>
				<title>SAGE</title>
			</Head>
			<section className="hero">
				<h1 className="hero__title">SAGE</h1>
				<h2 className="hero__subtitle">
					Crafting most fair products <br /> and experiences in Metaverse
				</h2>
			</section>
		</div>
	);
}
