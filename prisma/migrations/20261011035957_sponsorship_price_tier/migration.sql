-- Faixa de preço do pedido (spec sponsorship-election-pricing FR-02).
-- CreateEnum
CREATE TYPE "sponsorship_price_tier" AS ENUM ('standard', 'election_day');

-- AlterTable: pedidos existentes foram cobrados pela tabela cheia → election_day; depois a coluna
-- fica sem default (toda escrita nova informa a faixa).
ALTER TABLE "sponsorship" ADD COLUMN "price_tier" "sponsorship_price_tier" NOT NULL DEFAULT 'election_day';
ALTER TABLE "sponsorship" ALTER COLUMN "price_tier" DROP DEFAULT;
