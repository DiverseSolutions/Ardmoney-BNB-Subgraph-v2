import {
  Address,
  BigInt,
} from "@graphprotocol/graph-ts"

// Initialize a Token Definition with the attributes
export class TokenDefinition {
  address : Address
  symbol: string
  name: string
  decimals: BigInt

  // Initialize a Token Definition with its attributes
  constructor(address: Address, symbol: string, name: string, decimals: BigInt) {
    this.address = address
    this.symbol = symbol
    this.name = name
    this.decimals = decimals
  }

  // Get all tokens with a static defintion
  // Get all tokens with a static defintion
  static getStaticDefinitions(): Array<TokenDefinition> {
    let staticDefinitions = new Array<TokenDefinition>(6)

    let tokenTKNA = new TokenDefinition(
      Address.fromString('0x8A250B3517AD8d59354D50af0D9be5c4Cd90F070'),
      'TKNA',
      'TKNA',
      BigInt.fromI32(18)
    )
    staticDefinitions.push(tokenTKNA)
    
    let tokenTKNB = new TokenDefinition(
      Address.fromString('0x551181Be541f56ce6C6c13448F54Adb8eA2AB531'),
      'TKNB',
      'TKNB',
      BigInt.fromI32(18)
    )
    staticDefinitions.push(tokenTKNB)
    
    return staticDefinitions
  }

  // Helper for hardcoded tokens
  static fromAddress(tokenAddress: Address) : TokenDefinition | null {
    let staticDefinitions = this.getStaticDefinitions()
    let tokenAddressHex = tokenAddress.toHexString()

    // Search the definition using the address
    for (let i = 0; i < staticDefinitions.length; i++) {
      let staticDefinition = staticDefinitions[i]
      if(staticDefinition.address.toHexString() == tokenAddressHex) {
        return staticDefinition
      }
    }

    // If not found, return null
    return null
  }

}