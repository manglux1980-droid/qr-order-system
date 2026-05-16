import Omise from 'omise';

export const omise = Omise({
  publicKey: process.env.OMISE_PUBLIC_KEY!,
  secretKey: process.env.OMISE_SECRET_KEY!,
  omiseVersion: '2019-05-29',
});
