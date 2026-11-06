import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

// S0lana metadata registration — Devnet only.
// This script does NOT mint tokens or change the existing supply.

const MINT_ADDRESS = "F6ns4PHBs9mQjCRQj8bymJ3GsHNaLFsTHoYYDtUDH1Vi";
const METADATA_URI =
  "https://raw.githubusercontent.com/peggydc790-ui/curly-octo-happiness/main/metadata.json";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

function u32le(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value, 0);
  return out;
}

function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([u32le(bytes.length), bytes]);
}

async function main() {
  const wallet = pg.wallet.keypair;
  const mint = new PublicKey(MINT_ADDRESS);

  console.log("Checking S0lana mint and metadata before sending anything...");
  console.log("Connected wallet:", wallet.publicKey.toBase58());

  if (wallet.publicKey.toBase58() !== "8oG2449sKgjVfUn9TR8rEuEvzea9SPaMp1orZCau2ifs") {
    throw new Error("Wrong Playground wallet. Stopped without sending a transaction.");
  }

  const mintAccount = await pg.connection.getParsedAccountInfo(mint, "confirmed");
  if (!mintAccount.value) {
    throw new Error("S0lana mint account was not found on this cluster.");
  }
  if (!mintAccount.value.owner.equals(TOKEN_PROGRAM_ID)) {
    throw new Error("Mint is not owned by the classic SPL Token Program. Stopped.");
  }

  const parsedInfo = (mintAccount.value.data as any)?.parsed?.info;
  if (!parsedInfo) {
    throw new Error("Could not read parsed mint data. Stopped.");
  }
  if (parsedInfo.mintAuthority !== wallet.publicKey.toBase58()) {
    throw new Error("Connected wallet is not the mint authority. Stopped.");
  }

  const metadataResponse = await fetch(METADATA_URI);
  if (!metadataResponse.ok) {
    throw new Error("The GitHub metadata JSON could not be fetched. Stopped.");
  }
  const json = await metadataResponse.json();
  if (
    json.name !== "S0lana" ||
    json.symbol !== "S0L" ||
    typeof json.image !== "string" ||
    !json.image.includes("bafybeiewkhrnv4uyzt26f6dz73563rczmpeajxxls2t6kevmziav3nbeeq")
  ) {
    throw new Error("The hosted metadata JSON did not match the expected S0lana details. Stopped.");
  }

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    TOKEN_METADATA_PROGRAM_ID
  );

  const existingMetadata = await pg.connection.getAccountInfo(metadataPda, "confirmed");
  if (existingMetadata) {
    throw new Error(
      "A Metaplex metadata account already exists for this mint. No transaction was sent."
    );
  }

  // CreateMetadataAccountV3 (instruction discriminator 33).
  // DataV2: name, symbol, URI, 0 seller fee, no creators, no collection,
  // no uses; mutable=true; no collection details.
  const instructionData = Buffer.concat([
    Buffer.from([33]),
    borshString("S0lana"),
    borshString("S0L"),
    borshString(METADATA_URI),
    Buffer.from([0, 0]), // sellerFeeBasisPoints: u16 = 0
    Buffer.from([0]), // creators: None
    Buffer.from([0]), // collection: None
    Buffer.from([0]), // uses: None
    Buffer.from([1]), // isMutable: true
    Buffer.from([0]), // collectionDetails: None
  ]);

  const instruction = new TransactionInstruction({
    programId: TOKEN_METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: instructionData,
  });

  console.log("Preflight checks passed.");
  console.log("Mint:", mint.toBase58());
  console.log("Metadata account:", metadataPda.toBase58());
  console.log("Name: S0lana | Symbol: S0L");
  console.log("Supply will not be changed.");
  console.log("Submitting the metadata-registration transaction...");

  const transaction = new Transaction().add(instruction);
  const signature = await sendAndConfirmTransaction(
    pg.connection,
    transaction,
    [wallet],
    { commitment: "confirmed" }
  );

  console.log("SUCCESS — S0lana metadata registered.");
  console.log("Transaction:", signature);
  console.log(
    "Explorer:",
    `https://explorer.solana.com/tx/${signature}?cluster=devnet`
  );
  console.log("Metadata account:", metadataPda.toBase58());
}

main().catch((error) => {
  console.error("S0lana metadata registration stopped:", error);
});
