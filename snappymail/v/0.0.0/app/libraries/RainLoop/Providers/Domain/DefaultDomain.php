<?php

namespace RainLoop\Providers\Domain;

class DefaultDomain implements DomainInterface
{
	/**
	 * @var string
	 */
	protected $sDomainPath;

	/**
	 * @var \MailSo\Cache\CacheClient
	 */
	protected $oCacher;

	public function __construct(string $sDomainPath, ?\MailSo\Cache\CacheClient $oCacher = null)
	{
		$this->sDomainPath = \rtrim(\trim($sDomainPath), '\\/');
		$this->oCacher = $oCacher;
	}

	public function codeFileName(string $sName, bool $bBack = false) : string
	{
		if ($bBack && 'default' === $sName) {
			return '*';
		}

		if (!$bBack && '*' === $sName) {
			return 'default';
		}

		return $bBack
			? \str_replace('_wildcard_', '*', \MailSo\Base\Utils::IdnToUtf8($sName, true))
			: \str_replace('*', '_wildcard_', \MailSo\Base\Utils::IdnToAscii($sName, true));
	}

	private function wildcardDomainsCacheKey() : string
	{
		return '/WildCard/DomainCache/'.\md5(APP_VERSION.APP_PRIVATE_DATA_NAME).'/';
	}

	private function getWildcardDomainsLine() : string
	{
		if ($this->oCacher)
		{
			$sResult = $this->oCacher->Get($this->wildcardDomainsCacheKey());
			if (\strlen($sResult))
			{
				return $sResult;
			}
		}

		$sResult = '';
		$aNames = array();

		$aList = \glob($this->sDomainPath.'/*.ini');
		foreach ($aList as $sFile)
		{
			$sName = \substr(\basename($sFile), 0, -4);
			if ('default' === $sName || false !== \strpos($sName, '_wildcard_'))
			{
				$aNames[] = $this->codeFileName($sName, true);
			}
		}

		if (\count($aNames))
		{
			\rsort($aNames, SORT_STRING);
			$sResult = \implode(' ', $aNames);
		}

		if ($this->oCacher)
		{
			$this->oCacher->Set($this->wildcardDomainsCacheKey(), $sResult);
		}

		return $sResult;
	}

	public function Load(string $sName, bool $bFindWithWildCard = false, bool $bCheckDisabled = true, bool $bCheckAliases = true) : ?\RainLoop\Model\Domain
	{
		$mResult = null;

		$sDisabled = '';
		$sFoundValue = '';

		$sRealFileName = $this->codeFileName($sName);

		if (\file_exists($this->sDomainPath.'/disabled'))
		{
			$sDisabled = \file_get_contents($this->sDomainPath.'/disabled');
		}

		if (\file_exists($this->sDomainPath.'/'.$sRealFileName.'.ini') &&
			(!$bCheckDisabled || 0 === \strlen($sDisabled) || false === \strpos(','.$sDisabled.',', ','.\MailSo\Base\Utils::IdnToAscii($sName, true).',')))
		{
			$aDomain = \RainLoop\Utils::CustomParseIniFile($this->sDomainPath.'/'.$sRealFileName.'.ini');
//			if ($bCheckAliases && !empty($aDomain['alias']))
//			{
//				$oDomain = $this->Load($aDomain['alias'], false, false, false);
//				if ($oDomain && $oDomain instanceof \RainLoop\Model\Domain)
//				{
//					$oDomain->SetAliasName($sName);
//				}
//
//				return $oDomain;
//			}
			$mResult = \RainLoop\Model\Domain::NewInstanceFromDomainConfigArray($sName, $aDomain);
		}
		else if ($bCheckAliases && \file_exists($this->sDomainPath.'/'.$sRealFileName.'.alias') &&
			(!$bCheckDisabled || 0 === \strlen($sDisabled) || false === \strpos(','.$sDisabled.',', ','.\MailSo\Base\Utils::IdnToAscii($sName, true).',')))
		{
			$sAlias = \trim(\file_get_contents($this->sDomainPath.'/'.$sRealFileName.'.alias'));
			if (!empty($sAlias))
			{
				$oDomain = $this->Load($sAlias, false, false, false);
				if ($oDomain && $oDomain instanceof \RainLoop\Model\Domain)
				{
					$oDomain->SetAliasName($sName);
				}

				return $oDomain;
			}
		}
		else if ($bFindWithWildCard)
		{
			$sNames = $this->getWildcardDomainsLine();
			if (\strlen($sNames))
			{
				if (\RainLoop\Plugins\Helper::ValidateWildcardValues(
					\MailSo\Base\Utils::IdnToUtf8($sName, true), $sNames, $sFoundValue) && \strlen($sFoundValue))
				{
					if (!$bCheckDisabled || 0 === \strlen($sDisabled) || false === \strpos(','.$sDisabled.',', ','.$sFoundValue.','))
					{
						$mResult = $this->Load($sFoundValue, false);
					}
				}
			}
		}

		return $mResult;
	}

	public function Save(\RainLoop\Model\Domain $oDomain) : bool
	{
		$sRealFileName = $this->codeFileName($oDomain->Name());

		if ($this->oCacher)
		{
			$this->oCacher->Delete($this->wildcardDomainsCacheKey());
		}

		\RainLoop\Utils::saveFile($this->sDomainPath.'/'.$sRealFileName.'.ini', $oDomain->ToIniString());

		return true;
	}

	public function SaveAlias(string $sName, string $sAlias) : bool
	{
		$sRealFileName = $this->codeFileName($sName);

		if ($this->oCacher)
		{
			$this->oCacher->Delete($this->wildcardDomainsCacheKey());
		}

		\RainLoop\Utils::saveFile($this->sDomainPath.'/'.$sRealFileName.'.alias', $sAlias);
		return true;
	}

	public function Disable(string $sName, bool $bDisable) : bool
	{
		$sName = \MailSo\Base\Utils::IdnToAscii($sName, true);

		$sFile = '';
		if (\file_exists($this->sDomainPath.'/disabled'))
		{
			$sFile = \file_get_contents($this->sDomainPath.'/disabled');
		}

		$aResult = array();
		$aNames = \explode(',', $sFile);
		if ($bDisable)
		{
			\array_push($aNames, $sName);
			$aResult = $aNames;
		}
		else
		{
			foreach ($aNames as $sItem)
			{
				if ($sName !== $sItem)
				{
					$aResult[] = $sItem;
				}
			}
		}

		\RainLoop\Utils::saveFile($this->sDomainPath.'/disabled', \trim(\implode(',', \array_unique($aResult)), ', '));
		return true;
	}

	public function Delete(string $sName) : bool
	{
		$bResult = true;
		$sRealFileName = $this->codeFileName($sName);

		if (\strlen($sName))
		{
			if (\file_exists($this->sDomainPath.'/'.$sRealFileName.'.ini'))
			{
				$bResult = \unlink($this->sDomainPath.'/'.$sRealFileName.'.ini');
			}
			else if (\file_exists($this->sDomainPath.'/'.$sRealFileName.'.alias'))
			{
				$bResult = \unlink($this->sDomainPath.'/'.$sRealFileName.'.alias');
			}
		}

		if ($bResult)
		{
			$this->Disable($sName, false);
		}

		if ($this->oCacher)
		{
			$this->oCacher->Delete($this->wildcardDomainsCacheKey());
		}

		return $bResult;
	}

	public function GetList(bool $bIncludeAliases = true) : array
	{
		$aResult = array();
		$aWildCards = array();
		$aAliases = array();

//		$aList = \glob($this->sDomainPath.'/*.{ini,alias}', GLOB_BRACE);
		$aList = \array_diff(\scandir($this->sDomainPath), array('.', '..'));
		foreach ($aList as $sFile)
		{
			$sName = $sFile;
			if ('.ini' === \substr($sName, -4) || '.alias' === \substr($sName, -6))
			{
				$bAlias = '.alias' === \substr($sName, -6);

				$sName = \preg_replace('/\.(ini|alias)$/', '', $sName);
				$sName = $this->codeFileName($sName, true);

				if ($bAlias)
				{
					if ($bIncludeAliases)
					{
						$aAliases[] = $sName;
					}
				}
				else if (false !== \strpos($sName, '*'))
				{
					$aWildCards[] = $sName;
				}
				else
				{
					$aResult[] = $sName;
				}
			}
		}

		\sort($aResult, SORT_STRING);
		\sort($aAliases, SORT_STRING);
		\rsort($aWildCards, SORT_STRING);

		$aResult = \array_merge($aResult, $aAliases, $aWildCards);

		$aDisabledNames = array();
		if (\count($aResult) && \file_exists($this->sDomainPath.'/disabled'))
		{
			$sDisabled = \file_get_contents($this->sDomainPath.'/disabled');
			if (false !== $sDisabled && \strlen($sDisabled))
			{
				$aDisabledNames = \explode(',', $sDisabled);
				$aDisabledNames = \array_unique($aDisabledNames);
				foreach ($aDisabledNames as $iIndex => $sValue)
				{
					$aDisabledNames[$iIndex] = \MailSo\Base\Utils::IdnToUtf8($sValue, true);
				}
			}
		}

		$aReturn = array();
		foreach ($aResult as $sName)
		{
			$aReturn[] = array(
				'name' => $sName,
				'disabled' => \in_array($sName, $aDisabledNames),
				'alias' => \in_array($sName, $aAliases)
			);
		}

		return $aReturn;
	}
}
