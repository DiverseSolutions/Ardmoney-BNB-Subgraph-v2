/* eslint-disable prefer-const */
import { BigInt, BigDecimal, store, Address } from '@graphprotocol/graph-ts'
import {
  Pair,
  Token,
  UniswapFactory,
  Transaction,
  Mint as MintEvent,
  Burn as BurnEvent,
  Swap as SwapEvent,
  Bundle
} from '../types/schema'
import { Pair as PairContract, Mint, Burn, Swap, Transfer, Sync } from '../types/templates/Pair/Pair'
import { updatePairDayData, updateTokenDayData, updateUniswapDayData, updatePairHourData } from './dayUpdates'
import {
  getEthPriceInUSD,
  findEthPerToken,
  getTrackedVolumeUSD,
  getTrackedLiquidityUSD,
  findMntPerToken,
  getVolumeMNT
} from './pricing'
import {
  convertTokenToDecimal,
  ADDRESS_ZERO,
  FACTORY_ADDRESS,
  ONE_BI,
  createUser,
  createLiquidityPosition,
  ZERO_BD,
  BI_18,
  createLiquiditySnapshot
} from './helpers'

function isCompleteMint(mintId: string): boolean {
  let mint = MintEvent.load(mintId)
  return mint !== null && mint.sender !== null
}

export function handleTransfer(event: Transfer): void {
  // ignore initial transfers for first adds
  if (event.params.to.toHexString() == ADDRESS_ZERO && event.params.value.equals(BigInt.fromI32(1000))) {
    return
  }

  let factory = UniswapFactory.load(FACTORY_ADDRESS)
  if (factory === null) {
    // Handle the case where factory is not found, possibly log an error
    return
  }

  let transactionHash = event.transaction.hash.toHexString()

  // user stats
  let from = event.params.from
  createUser(from)
  let to = event.params.to
  createUser(to)

  // get pair and load contract
  let pair = Pair.load(event.address.toHexString())
  if (pair === null) {
    // Handle the case where pair is not found, possibly log an error
    return
  }

  let pairContract = PairContract.bind(event.address)

  // liquidity token amount being transferred
  let value = convertTokenToDecimal(event.params.value, BI_18)

  // get or create transaction
  let transaction = Transaction.load(transactionHash)
  if (transaction === null) {
    transaction = new Transaction(transactionHash)
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.mints = []
    transaction.burns = []
    transaction.swaps = []
  }

  // mints
  let mints = transaction.mints
  if (from.toHexString() == ADDRESS_ZERO) {
    // update total supply
    pair.totalSupply = pair.totalSupply.plus(value)
    pair.save()

    // create new mint if no mints so far or if last one is done already
    if (mints.length === 0 || (mints.length > 0 && isCompleteMint(mints[mints.length - 1]))) {
      let mintId = event.transaction.hash
        .toHexString()
        .concat('-')
        .concat(BigInt.fromI32(mints.length).toString())
      let mint = new MintEvent(mintId)
      mint.transaction = transaction.id
      mint.pair = pair.id
      mint.to = to
      mint.liquidity = value
      mint.timestamp = transaction.timestamp
      mint.transaction = transaction.id
      mint.save()

      // update mints in transaction
      transaction.mints = mints.concat([mint.id])

      // save entities
      transaction.save()
      factory.save()
    }
  }

  // case where direct send first on ETH withdrawals
  if (event.params.to.toHexString() == pair.id) {
    let burns = transaction.burns
    let burnId = event.transaction.hash
      .toHexString()
      .concat('-')
      .concat(BigInt.fromI32(burns.length).toString())
    let burn = new BurnEvent(burnId)
    burn.transaction = transaction.id
    burn.pair = pair.id
    burn.liquidity = value
    burn.timestamp = transaction.timestamp
    burn.to = event.params.to
    burn.sender = event.params.from
    burn.needsComplete = true
    burn.transaction = transaction.id
    burn.save()

    burns.push(burn.id)
    transaction.burns = burns
    transaction.save()
  }

  // burn
  if (event.params.to.toHexString() == ADDRESS_ZERO && event.params.from.toHexString() == pair.id) {
    pair.totalSupply = pair.totalSupply.minus(value)
    pair.save()

    let burns = transaction.burns
    let burn: BurnEvent
    if (burns.length > 0) {
      let currentBurn = BurnEvent.load(burns[burns.length - 1])
      if (currentBurn === null) {
        // Handle the case where currentBurn is not found, possibly log an error
        return
      }
      if (currentBurn.needsComplete) {
        burn = currentBurn
      } else {
        let burnId = event.transaction.hash
          .toHexString()
          .concat('-')
          .concat(BigInt.fromI32(burns.length).toString())
        burn = new BurnEvent(burnId)
        burn.transaction = transaction.id
        burn.needsComplete = false
        burn.pair = pair.id
        burn.liquidity = value
        burn.transaction = transaction.id
        burn.timestamp = transaction.timestamp
      }
    } else {
      let burnId = event.transaction.hash
        .toHexString()
        .concat('-')
        .concat(BigInt.fromI32(burns.length).toString())
      burn = new BurnEvent(burnId)
      burn.transaction = transaction.id
      burn.needsComplete = false
      burn.pair = pair.id
      burn.liquidity = value
      burn.transaction = transaction.id
      burn.timestamp = transaction.timestamp
    }

    // if this logical burn included a fee mint, account for this
    if (mints.length !== 0 && !isCompleteMint(mints[mints.length - 1])) {
      let mint = MintEvent.load(mints[mints.length - 1])
      if (mint !== null) {
        burn.feeTo = mint.to
        burn.feeLiquidity = mint.liquidity
        // remove the logical mint
        store.remove('Mint', mints[mints.length - 1])
        // update the transaction
        mints.pop()
        transaction.mints = mints
        transaction.save()
      }
    }
    burn.save()
    // if accessing last one, replace it
    if (burn.needsComplete) {
      burns[burns.length - 1] = burn.id
    } else {
      burns.push(burn.id)
    }
    transaction.burns = burns
    transaction.save()
  }

  if (from.toHexString() != ADDRESS_ZERO && from.toHexString() != pair.id) {
    let fromUserLiquidityPosition = createLiquidityPosition(event.address, from)
    fromUserLiquidityPosition.liquidityTokenBalance = convertTokenToDecimal(pairContract.balanceOf(from), BI_18)
    fromUserLiquidityPosition.save()
    createLiquiditySnapshot(fromUserLiquidityPosition, event)
  }

  if (event.params.to.toHexString() != ADDRESS_ZERO && to.toHexString() != pair.id) {
    let toUserLiquidityPosition = createLiquidityPosition(event.address, to)
    toUserLiquidityPosition.liquidityTokenBalance = convertTokenToDecimal(pairContract.balanceOf(to), BI_18)
    toUserLiquidityPosition.save()
    createLiquiditySnapshot(toUserLiquidityPosition, event)
  }

  transaction.save()
}

export function handleSync(event: Sync): void {
  let pair = Pair.load(event.address.toHex())!
  if (pair === null) {
    // Handle the case where pair is not found, possibly log an error
    return
  }

  let token0 = Token.load(pair.token0)
  if (token0 === null) {
    // Handle the case where token0 is not found, possibly log an error
    return
  }

  let token1 = Token.load(pair.token1)
  if (token1 === null) {
    // Handle the case where token1 is not found, possibly log an error
    return
  }

  let uniswap = UniswapFactory.load(FACTORY_ADDRESS)
  if (uniswap === null) {
    // Handle the case where uniswap is not found, possibly log an error
    return
  }

  // Reset factory liquidity by subtracting only tracked liquidity
  uniswap.totalLiquidityETH = uniswap.totalLiquidityETH.minus(pair.trackedReserveETH as BigDecimal)

  // Reset token total liquidity amounts
  token0.totalLiquidity = token0.totalLiquidity.minus(pair.reserve0)
  token1.totalLiquidity = token1.totalLiquidity.minus(pair.reserve1)

  pair.reserve0 = convertTokenToDecimal(event.params.reserve0, token0.decimals)
  pair.reserve1 = convertTokenToDecimal(event.params.reserve1, token1.decimals)

  if (pair.reserve1.notEqual(ZERO_BD)) {
    pair.token0Price = pair.reserve0.div(pair.reserve1)
  } else {
    pair.token0Price = ZERO_BD
  }

  if (pair.reserve0.notEqual(ZERO_BD)) {
    pair.token1Price = pair.reserve1.div(pair.reserve0)
  } else {
    pair.token1Price = ZERO_BD
  }

  pair.save()

  // Update ETH price now that reserves could have changed
  let bundle = Bundle.load('1')
  if (bundle === null) {
    // Handle the case where bundle is not found, possibly log an error
    return
  }

  bundle.ethPrice = getEthPriceInUSD()
  bundle.save()

  token0.derivedETH = findEthPerToken(token0 as Token)
  token1.derivedETH = findEthPerToken(token1 as Token)

  // MNT
  token0.mnt = findMntPerToken(token0 as Token)
  token1.mnt = findMntPerToken(token1 as Token)

  token0.save()
  token1.save()

  // Get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityETH: BigDecimal
  if (bundle.ethPrice.notEqual(ZERO_BD)) {
    trackedLiquidityETH = getTrackedLiquidityUSD(pair.reserve0, token0 as Token, pair.reserve1, token1 as Token).div(
      bundle.ethPrice
    )
  } else {
    trackedLiquidityETH = ZERO_BD
  }

  // Use derived amounts within pair
  pair.trackedReserveETH = trackedLiquidityETH
  pair.reserveETH = pair.reserve0
    .times(token0.derivedETH as BigDecimal)
    .plus(pair.reserve1.times(token1.derivedETH as BigDecimal))
  pair.reserveUSD = pair.reserveETH.times(bundle.ethPrice)

  // MNT
  pair.reserveMNT = pair.reserve0.times(token0.mnt as BigDecimal).plus(pair.reserve1.times(token1.mnt as BigDecimal))

  // Use tracked amounts globally
  uniswap.totalLiquidityETH = uniswap.totalLiquidityETH.plus(trackedLiquidityETH)
  uniswap.totalLiquidityUSD = uniswap.totalLiquidityETH.times(bundle.ethPrice)

  // Now correctly set liquidity amounts for each token
  token0.totalLiquidity = token0.totalLiquidity.plus(pair.reserve0)
  token1.totalLiquidity = token1.totalLiquidity.plus(pair.reserve1)

  // Save entities
  pair.save()
  uniswap.save()
  token0.save()
  token1.save()
}

export function handleMint(event: Mint): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction === null) {
    // Handle the case where transaction is not found, possibly log an error
    return
  }

  let mints = transaction.mints
  if (mints.length === 0) {
    // Handle the case where there are no mints, possibly log an error
    return
  }

  let mint = MintEvent.load(mints[mints.length - 1])
  if (mint === null) {
    // Handle the case where mint is not found, possibly log an error
    return
  }

  let pair = Pair.load(event.address.toHex())
  if (pair === null) {
    // Handle the case where pair is not found, possibly log an error
    return
  }

  let uniswap = UniswapFactory.load(FACTORY_ADDRESS)
  if (uniswap === null) {
    // Handle the case where uniswap is not found, possibly log an error
    return
  }

  let token0 = Token.load(pair.token0)
  if (token0 === null) {
    // Handle the case where token0 is not found, possibly log an error
    return
  }

  let token1 = Token.load(pair.token1)
  if (token1 === null) {
    // Handle the case where token1 is not found, possibly log an error
    return
  }

  // Ensure derivedETH is not null
  let derivedETH0 = token0.derivedETH
  let derivedETH1 = token1.derivedETH
  if (derivedETH0 === null || derivedETH1 === null) {
    // Handle the case where derivedETH values are not found, possibly log an error
    return
  }

  // Update exchange info (except balances, sync will cover that)
  let token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals)

  // Update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // Get new amounts of USD and ETH for tracking
  let bundle = Bundle.load('1')
  if (bundle === null) {
    // Handle the case where bundle is not found, possibly log an error
    return
  }

  let amountTotalUSD = derivedETH1
    .times(token1Amount)
    .plus(derivedETH0.times(token0Amount))
    .times(bundle.ethPrice)

  // Update txn counts
  pair.txCount = pair.txCount.plus(ONE_BI)
  uniswap.txCount = uniswap.txCount.plus(ONE_BI)

  // Save entities
  token0.save()
  token1.save()
  pair.save()
  uniswap.save()

  mint.sender = event.params.sender
  mint.amount0 = token0Amount as BigDecimal
  mint.amount1 = token1Amount as BigDecimal
  mint.logIndex = event.logIndex
  mint.amountUSD = amountTotalUSD as BigDecimal
  mint.amountMNT = token0Amount.times(token0.mnt).plus(token1Amount.times(token1.mnt))
  mint.save()

  // Update the LP position
  let liquidityPosition = createLiquidityPosition(event.address, Address.fromBytes(mint.to))
  createLiquiditySnapshot(liquidityPosition, event)

  // Update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateUniswapDayData(event)
  updateTokenDayData(token0 as Token, event)
  updateTokenDayData(token1 as Token, event)
}

export function handleBurn(event: Burn): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())

  // Safety check for transaction
  if (transaction === null) {
    return
  }

  let burns = transaction.burns
  if (burns.length === 0) {
    return // No burns available in this transaction
  }

  let burn = BurnEvent.load(burns[burns.length - 1])
  if (burn === null) {
    return // No burn event found
  }

  let pair = Pair.load(event.address.toHex())
  if (pair === null) {
    return // No pair found
  }

  let uniswap = UniswapFactory.load(FACTORY_ADDRESS)
  if (uniswap === null) {
    return // No Uniswap factory found
  }

  let token0 = Token.load(pair.token0)
  if (token0 === null) {
    return // No token0 found
  }

  let token1 = Token.load(pair.token1)
  if (token1 === null) {
    return // No token1 found
  }

  // Ensure derivedETH is not null
  let derivedETH0 = token0.derivedETH
  let derivedETH1 = token1.derivedETH
  if (derivedETH0 === null || derivedETH1 === null) {
    return // Handle the case where derivedETH values are not found
  }

  // Update token info
  let token0Amount = convertTokenToDecimal(event.params.amount0, token0.decimals)
  let token1Amount = convertTokenToDecimal(event.params.amount1, token1.decimals)

  // Update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // Get new amounts of USD and ETH for tracking
  let bundle = Bundle.load('1')
  if (bundle === null) {
    return // No bundle found
  }

  let amountTotalUSD = derivedETH1
    .times(token1Amount)
    .plus(derivedETH0.times(token0Amount))
    .times(bundle.ethPrice)

  // Update txn counts
  uniswap.txCount = uniswap.txCount.plus(ONE_BI)
  pair.txCount = pair.txCount.plus(ONE_BI)

  // Update global counter and save
  token0.save()
  token1.save()
  pair.save()
  uniswap.save()

  // Update burn
  burn.amount0 = token0Amount as BigDecimal
  burn.amount1 = token1Amount as BigDecimal
  burn.logIndex = event.logIndex
  burn.amountUSD = amountTotalUSD as BigDecimal
  burn.amountMNT = token1.mnt.plus(token0.mnt)
  burn.save()

  // Update the LP position

  let liquidityPosition = createLiquidityPosition(event.address, Address.fromBytes(burn.sender!))
  createLiquiditySnapshot(liquidityPosition, event)

  // Update day entities
  updatePairDayData(event)
  updatePairHourData(event)
  updateUniswapDayData(event)
  updateTokenDayData(token0 as Token, event)
  updateTokenDayData(token1 as Token, event)
}

export function handleSwap(event: Swap): void {
  let pair = Pair.load(event.address.toHexString())
  if (pair === null) {
    return // No pair found
  }

  let token0 = Token.load(pair.token0)
  if (token0 === null) {
    return // No token0 found
  }

  let token1 = Token.load(pair.token1)
  if (token1 === null) {
    return // No token1 found
  }

  // Ensure derivedETH is not null
  let derivedETH0 = token0.derivedETH
  let derivedETH1 = token1.derivedETH
  if (derivedETH0 === null || derivedETH1 === null) {
    return // Handle the case where derivedETH values are not found
  }

  let amount0In = convertTokenToDecimal(event.params.amount0In, token0.decimals)
  let amount1In = convertTokenToDecimal(event.params.amount1In, token1.decimals)
  let amount0Out = convertTokenToDecimal(event.params.amount0Out, token0.decimals)
  let amount1Out = convertTokenToDecimal(event.params.amount1Out, token1.decimals)

  // Totals for volume updates
  let amount0Total = amount0Out.plus(amount0In)
  let amount1Total = amount1Out.plus(amount1In)

  // ETH/USD prices
  let bundle = Bundle.load('1')
  if (bundle === null) {
    return // No bundle found
  }

  // Get total amounts of derived USD and ETH for tracking
  let derivedAmountETH = derivedETH1
    .times(amount1Total)
    .plus(derivedETH0.times(amount0Total))
    .div(BigDecimal.fromString('2'))

  let derivedAmountUSD = derivedAmountETH.times(bundle.ethPrice)

  // Only accounts for volume through white listed tokens
  let trackedAmountUSD = getTrackedVolumeUSD(amount0Total, token0 as Token, amount1Total, token1 as Token, pair as Pair)
  let volumeMNT = getVolumeMNT(amount0Total, token0 as Token, amount1Total, token1 as Token, pair as Pair)

  let trackedAmountETH: BigDecimal
  if (bundle.ethPrice.equals(ZERO_BD)) {
    trackedAmountETH = ZERO_BD
  } else {
    trackedAmountETH = trackedAmountUSD.div(bundle.ethPrice)
  }

  // Update token0 global volume and token liquidity stats
  token0.tradeVolume = token0.tradeVolume.plus(amount0In.plus(amount0Out))
  token0.tradeVolumeUSD = token0.tradeVolumeUSD.plus(trackedAmountUSD)
  token0.tradeVolumeMNT = token0.tradeVolumeMNT.plus(volumeMNT)
  token0.untrackedVolumeUSD = token0.untrackedVolumeUSD.plus(derivedAmountUSD)

  // Update token1 global volume and token liquidity stats
  token1.tradeVolume = token1.tradeVolume.plus(amount1In.plus(amount1Out))
  token1.tradeVolumeUSD = token1.tradeVolumeUSD.plus(trackedAmountUSD)
  token1.tradeVolumeMNT = token1.tradeVolumeMNT.plus(volumeMNT)
  token1.untrackedVolumeUSD = token1.untrackedVolumeUSD.plus(derivedAmountUSD)

  // Update txn counts
  token0.txCount = token0.txCount.plus(ONE_BI)
  token1.txCount = token1.txCount.plus(ONE_BI)

  // Update pair volume data, use tracked amount if we have it as its probably more accurate
  pair.volumeUSD = pair.volumeUSD.plus(trackedAmountUSD)
  pair.volumeToken0 = pair.volumeToken0.plus(amount0Total)
  pair.volumeToken1 = pair.volumeToken1.plus(amount1Total)
  pair.untrackedVolumeUSD = pair.untrackedVolumeUSD.plus(derivedAmountUSD)
  pair.txCount = pair.txCount.plus(ONE_BI)
  pair.volumeMNT = getVolumeMNT(amount0Total, token0 as Token, amount1Total, token1 as Token, pair as Pair)

  pair.save()

  // Update global values, only used tracked amounts for volume
  let uniswap = UniswapFactory.load(FACTORY_ADDRESS)
  if (uniswap === null) {
    return // No Uniswap factory found
  }

  uniswap.totalVolumeUSD = uniswap.totalVolumeUSD.plus(trackedAmountUSD)
  uniswap.totalVolumeETH = uniswap.totalVolumeETH.plus(trackedAmountETH)
  uniswap.untrackedVolumeUSD = uniswap.untrackedVolumeUSD.plus(derivedAmountUSD)
  uniswap.txCount = uniswap.txCount.plus(ONE_BI)

  // Save entities
  pair.save()
  token0.save()
  token1.save()
  uniswap.save()

  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction === null) {
    transaction = new Transaction(event.transaction.hash.toHexString())
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.mints = []
    transaction.swaps = []
    transaction.burns = []
  }

  let swaps = transaction.swaps
  let swap = new SwapEvent(
    event.transaction.hash
      .toHexString()
      .concat('-')
      .concat(BigInt.fromI32(swaps.length).toString())
  )

  // Update swap event
  swap.transaction = transaction.id
  swap.pair = pair.id
  swap.timestamp = transaction.timestamp
  swap.sender = event.params.sender
  swap.amount0In = amount0In
  swap.amount1In = amount1In
  swap.amount0Out = amount0Out
  swap.amount1Out = amount1Out
  swap.to = event.params.to
  swap.from = event.transaction.from
  swap.logIndex = event.logIndex
  swap.amountUSD = trackedAmountUSD.equals(ZERO_BD) ? derivedAmountUSD : trackedAmountUSD
  swap.amountMNT = volumeMNT
  swap.save()

  // Update the transaction
  swaps.push(swap.id)
  transaction.swaps = swaps
  transaction.save()

  // Update day entities
  let pairDayData = updatePairDayData(event)
  let pairHourData = updatePairHourData(event)
  let uniswapDayData = updateUniswapDayData(event)
  let token0DayData = updateTokenDayData(token0 as Token, event)
  let token1DayData = updateTokenDayData(token1 as Token, event)

  // Swap specific updating
  uniswapDayData.dailyVolumeUSD = uniswapDayData.dailyVolumeUSD.plus(trackedAmountUSD)
  uniswapDayData.dailyVolumeETH = uniswapDayData.dailyVolumeETH.plus(trackedAmountETH)
  uniswapDayData.dailyVolumeUntracked = uniswapDayData.dailyVolumeUntracked.plus(derivedAmountUSD)
  uniswapDayData.save()

  // Swap specific updating for pair
  pairDayData.dailyVolumeToken0 = pairDayData.dailyVolumeToken0.plus(amount0Total)
  pairDayData.dailyVolumeToken1 = pairDayData.dailyVolumeToken1.plus(amount1Total)
  pairDayData.dailyVolumeUSD = pairDayData.dailyVolumeUSD.plus(trackedAmountUSD)
  pairDayData.save()

  // Update hourly pair data
  pairHourData.hourlyVolumeToken0 = pairHourData.hourlyVolumeToken0.plus(amount0Total)
  pairHourData.hourlyVolumeToken1 = pairHourData.hourlyVolumeToken1.plus(amount1Total)
  pairHourData.hourlyVolumeUSD = pairHourData.hourlyVolumeUSD.plus(trackedAmountUSD)
  pairHourData.save()

  // Swap specific updating for token0
  token0DayData.dailyVolumeToken = token0DayData.dailyVolumeToken.plus(amount0Total)
  token0DayData.dailyVolumeETH = token0DayData.dailyVolumeETH.plus(amount0Total.times(derivedETH0))
  token0DayData.dailyVolumeUSD = token0DayData.dailyVolumeUSD.plus(
    amount0Total.times(derivedETH0).times(bundle.ethPrice)
  )
  token0DayData.dailyVolumeMNT = token0DayData.dailyVolumeMNT.plus(amount0Total.times(token0.mnt))
  token0DayData.save()

  // Swap specific updating for token1
  token1DayData.dailyVolumeToken = token1DayData.dailyVolumeToken.plus(amount1Total)
  token1DayData.dailyVolumeETH = token1DayData.dailyVolumeETH.plus(amount1Total.times(derivedETH1))
  token1DayData.dailyVolumeUSD = token1DayData.dailyVolumeUSD.plus(
    amount1Total.times(derivedETH1).times(bundle.ethPrice)
  )
  token1DayData.dailyVolumeMNT = token1DayData.dailyVolumeMNT.plus(amount1Total.times(token1.mnt))
  token1DayData.save()
}
