<?php

namespace RainLoop;

class Utils
{
	/**
	 * @var string
	 */
	static $CookieDefaultPath = '';

	/**
	 * @var bool|null
	 */
	static $CookieDefaultSecure = null;

	const
		/**
		 * 30 days cookie
		 * Used by: ServiceProxyExternal, compileLogParams, GetCsrfToken
		 */
		CONNECTION_TOKEN = 'smtoken',

		/**
		 * Session cookie
		 * Used by: EncodeKeyValuesQ, DecodeKeyValuesQ and getAccountFromToken/SetAuthToken
		 */
		SHORT_TOKEN = 'smsession';

	public static function EncodeKeyValues(array $aValues, string $sCustomKey = '') : string
	{
		return \MailSo\Base\Utils::UrlSafeBase64Encode(
			\MailSo\Base\Crypt::Encrypt(
				\json_encode($aValues),
				\md5(APP_SALT.$sCustomKey)
			)
		);
	}

	public static function DecodeKeyValues(string $sEncodedValues, string $sCustomKey = '') : array
	{
		return static::unserialize(
			\MailSo\Base\Crypt::Decrypt(
				\MailSo\Base\Utils::UrlSafeBase64Decode($sEncodedValues),
				\md5(APP_SALT.$sCustomKey)
			)
		);
	}

	public static function EncodeKeyValuesQ(array $aValues, string $sCustomKey = '') : string
	{
		return \MailSo\Base\Utils::UrlSafeBase64Encode(
			\MailSo\Base\Crypt::Encrypt(
				\json_encode($aValues),
				\md5(APP_SALT.$sCustomKey).'Q'.static::GetShortToken()
		));
	}

	public static function DecodeKeyValuesQ(string $sEncodedValues, string $sCustomKey = '') : array
	{
		return static::unserialize(
			\MailSo\Base\Crypt::Decrypt(
				\MailSo\Base\Utils::UrlSafeBase64Decode($sEncodedValues),
				\md5(APP_SALT.$sCustomKey).'Q'.static::GetShortToken()
		));
	}

	public static function unserialize(string $sDecodedValues) : array
	{
		try {
			return \json_decode($sDecodedValues, true, 512, JSON_THROW_ON_ERROR) ?: array();
		} catch (\Throwable $e) {
			return \unserialize($sDecodedValues) ?: array();
		}
	}

	public static function GetShortToken() : string
	{
		$sToken = static::GetCookie(self::SHORT_TOKEN, null);
		if (!$sToken) {
			$sToken = \MailSo\Base\Utils::Sha1Rand(APP_SALT);
			static::SetCookie(self::SHORT_TOKEN, $sToken, 0);
		}

		return \md5('Session'.APP_SALT.$sToken.'Token'.APP_SALT);
	}

	public static function GetConnectionToken() : string
	{
		$sToken = static::GetCookie(self::CONNECTION_TOKEN);
		if (!$sToken)
		{
			$sToken = \MailSo\Base\Utils::Sha1Rand(APP_SALT);
			static::SetCookie(self::CONNECTION_TOKEN, $sToken, \time() + 3600 * 24 * 30);
		}

		return \md5('Connection'.APP_SALT.$sToken.'Token'.APP_SALT);
	}

	public static function GetCsrfToken() : string
	{
		return \md5('Csrf'.APP_SALT.self::GetConnectionToken().'Token'.APP_SALT);
	}

	public static function UpdateConnectionToken() : void
	{
		$sToken = static::GetCookie(self::CONNECTION_TOKEN);
		if ($sToken)
		{
			static::SetCookie(self::CONNECTION_TOKEN, $sToken, \time() + 3600 * 24 * 30);
		}
	}

	public static function PathMD5(string $sPath) : string
	{
		$sResult = '';
		if (\is_dir($sPath))
		{
			$oDirIterator = new \RecursiveDirectoryIterator($sPath);
			$oIterator = new \RecursiveIteratorIterator($oDirIterator, \RecursiveIteratorIterator::SELF_FIRST);

			foreach ($oIterator as $oFile)
			{
				$sResult = \md5($sResult.($oFile->isFile() ? \md5_file($oFile) : $oFile));
			}
		}

		return $sResult;
	}

	public static function ClearHtmlOutput(string $sHtml) : string
	{
//		return $sHtml;
		return \preg_replace(
			['@"\\s*/>@', '/\\s*&nbsp;/i', '/&nbsp;\\s*/i', '/[\\r\\n\\t]+/', '/>\\s+</'],
			['">', "\xC2\xA0", "\xC2\xA0", ' ', '><'],
			\trim($sHtml)
		);
	}

	/**
	 * @param mixed $mDefault = null
	 * @return mixed
	 */
	public static function GetCookie(string $sName, $mDefault = null)
	{
		return isset($_COOKIE[$sName]) ? $_COOKIE[$sName] : $mDefault;
	}

	public static function GetSecureCookie(string $sName)
	{
		return isset($_COOKIE[$sName])
			? \SnappyMail\Crypt::DecryptFromJSON(\MailSo\Base\Utils::UrlSafeBase64Decode($_COOKIE[$sName]))
			: null;
	}

	public static function SetCookie(string $sName, string $sValue = '', int $iExpire = 0, bool $bHttpOnly = true)
	{
		$sPath = static::$CookieDefaultPath;
		$_COOKIE[$sName] = $sValue;
		\setcookie($sName, $sValue, array(
			'expires' => $iExpire,
			'path' => $sPath && \strlen($sPath) ? $sPath : '/',
//			'domain' => $sDomain,
			'secure' => isset($_SERVER['HTTPS']) || static::$CookieDefaultSecure,
			'httponly' => $bHttpOnly,
			'samesite' => 'Strict'
		));
	}

	public static function SetSecureCookie(string $sName, $mValue, int $iExpire = 0, bool $bHttpOnly = true)
	{
		static::SetCookie(
			$sName,
			\MailSo\Base\Utils::UrlSafeBase64Encode(\SnappyMail\Crypt::EncryptToJSON($mValue)),
			$iExpire,
			true
		);
	}

	public static function ClearCookie(string $sName)
	{
		if (isset($_COOKIE[$sName])) {
			$sPath = static::$CookieDefaultPath;
			unset($_COOKIE[$sName]);
			\setcookie($sName, '', array(
				'expires' => \time() - 3600 * 24 * 30,
				'path' => $sPath && \strlen($sPath) ? $sPath : '/',
//				'domain' => null,
				'secure' => isset($_SERVER['HTTPS']) || static::$CookieDefaultSecure,
				'httponly' => true,
				'samesite' => 'Strict'
			));
		}
	}

	public static function UrlEncode(string $sV, bool $bEncode = false) : string
	{
		return $bEncode ? \urlencode($sV) : $sV;
	}

	public static function WebPath() : string
	{
		static $sAppPath;
		if (!$sAppPath) {
			$sAppPath = \preg_replace('#index\\.php.*$#D', '', $_SERVER['SCRIPT_NAME']);
//			$sAppPath = Api::Config()->Get('labs', 'app_default_path', '');
		}
		return $sAppPath;
	}

	public static function WebVersionPath() : string
	{
		return self::WebPath().'snappymail/v/'.APP_VERSION.'/';
	}

	public static function WebStaticPath() : string
	{
		return self::WebVersionPath().'static/';
	}

	public static function RemoveSuggestionDuplicates(array $aSuggestions) : array
	{
		$aResult = array();

		foreach ($aSuggestions as $aItem)
		{
			$sLine = \implode('~~', $aItem);
			if (!isset($aResult[$sLine]))
			{
				$aResult[$sLine] = $aItem;
			}
		}

		return array_values($aResult);
	}

	public static function CustomParseIniFile(string $sFileName, bool $bProcessSections = false) : array
	{
		return @\parse_ini_file($sFileName, !!$bProcessSections) ?: array();
//		return @\parse_ini_string(\file_get_contents($sFileName), $bProcessSections) ?: array();
	}

	/**
	 * Replace control characters, ampersand, spaces and reserved characters (based on Win95 VFAT)
	 * en.wikipedia.org/wiki/Filename#Reserved_characters_and_words
	 */
	public static function fixName(string $filename) : string
	{
		return \preg_replace('#[|\\\\?*<":>+\\[\\]/&\\s\\pC]#su', '-', $filename);
	}
}
